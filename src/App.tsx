import { useCallback, useEffect, useRef, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import gsap from 'gsap';
import { Scene } from './render/scene';
import { seedFromString } from './core/generator';
import { cloneState } from './core/engine';
import { solverClient } from './core/worker/client';
import { levelConfig, diffLabel, starsFor } from './game/levels';
import { MODES, type JourneyMode } from './game/modes';
import { loadWallet, saveWallet, rewardFor, coinsForLevel, activeBg, activeTube, bgBackdrop, TUBE_COIN_PRICE, FREE_UNDOS, UNDO_COIN_PRICE, type Wallet, type ShopItem } from './game/economy';
import { TUBE_SHAPE_SPECS } from './render/geometry';
import { loadProgress, saveProgress, loadDaily, saveDaily, loadSession, saveSession, clearSession, loadPrefs, savePrefs, type DailyRecord, type GameSession } from './game/settings';
import { ShopModal } from './ui/ShopModal';
import { BossIntroScreen } from './ui/BossIntroScreen';
import { AjustesModal } from './ui/AjustesModal';
import { CoinIcon } from './ui/CoinIcon';
import { WildTutorial } from './ui/WildTutorial';
import { bossAfterPhase, type BossData } from './game/boss';
import { audio, MUSIC_TRACKS, ONBOARDING_TRACK } from './audio/engine';
import type { MusicTrack, MusicMood } from './audio/engine';
import type { LevelConfig, GeneratedLevel } from './core/generator';
import { UpdateReadyModal } from './ui/UpdateReadyModal';
import { SumColumns } from './ui/SumColumns';
import { LEVEL_COUNT } from './game/flaskLogic';
import { loadRewardedAds, showRewardedAd, showShortAd } from './game/rewardedAd';
import { setUpdateReadyHandler } from './lib/pwaRegister';
import { markInstallPending, markVersionSeen, resolveVersionCatchUp } from './lib/appVersion';
import { useT } from './i18n/context';

type Screen = 'menu' | 'game';
type GameMode = 'journey' | 'daily';

/** Serializes Pixi startup so React StrictMode cannot open two WebGL contexts on one canvas. */
let sceneBoot: Promise<void> = Promise.resolve();

/** The last dynamic tracks played (most recent last) — excluded from the next draw so the mix
 *  never repeats back-to-back. Module state on purpose: survives menu↔game navigation. */
const recentDynamicTracks: string[] = [];
const RECENT_EXCLUDED = 2;

/** Mood weight per phase — a GRADUAL curve instead of the old binary cut (calm until phase 8,
 *  then upbeat/epic only, which collapsed the whole late game onto the same 2-3 loud tracks).
 *  Intensity t ramps 0→1 across phases 1→35; every mood keeps a non-zero weight at every
 *  phase, so calm tracks still appear late (less often) and epic ones appear early (rarely) —
 *  a proportional dynamic mix over all 9 tracks. */
function moodWeightAt(phaseIndex: number): Record<MusicMood, number> {
  const t = Math.min(1, Math.max(0, (phaseIndex - 1) / 34));
  return {
    calm:   1.0 - 0.62 * t, // 1.00 → 0.38
    upbeat: 0.25 + 0.45 * t, // 0.25 → 0.70
    epic:   0.10 + 0.90 * t, // 0.10 → 1.00
    boss:   0,               // reserved track, never drawn dynamically
  };
}

/** Selects the BGM track based on phase and boss state.
 *  If prefs.musicTrack is set to a specific track ID, that always wins.
 *  If 'dynamic' (or unset), the track is drawn by the weighted mood mix above. */
function selectTrackForPhase(
  phaseIndex: number,
  bossActive: boolean,
  musicTrackPref?: string,
): MusicTrack {
  if (bossActive) return 'boss';
  // Specific track forced by player preference (must exist in the manifest)
  if (musicTrackPref && musicTrackPref !== 'dynamic'
      && MUSIC_TRACKS.some(t => t.id === musicTrackPref)) {
    return musicTrackPref;
  }
  // Phase 1 (index 0) explicitly reuses the same welcome track as the main menu — it does not
  // depend on the order of the MUSIC_TRACKS array. The dynamic algorithm only kicks in from
  // phase 2 onward. (Daily always calls with phaseIndex 0, so it gets the same fixed track on
  // every attempt.)
  if (phaseIndex === 0) return ONBOARDING_TRACK;
  // Weighted draw over the whole manifest, excluding the last RECENT_EXCLUDED tracks played.
  const weights = moodWeightAt(phaseIndex);
  let pool = MUSIC_TRACKS.filter(t => weights[t.mood] > 0 && !recentDynamicTracks.includes(t.id));
  if (pool.length === 0) pool = MUSIC_TRACKS.filter(t => weights[t.mood] > 0);
  if (pool.length === 0) return MUSIC_TRACKS[0]?.id ?? 'menu';
  const total = pool.reduce((s, t) => s + weights[t.mood], 0);
  let r = Math.random() * total;
  let chosen = pool[pool.length - 1];
  for (const t of pool) {
    r -= weights[t.mood];
    if (r <= 0) { chosen = t; break; }
  }
  recentDynamicTracks.push(chosen.id);
  if (recentDynamicTracks.length > RECENT_EXCLUDED) recentDynamicTracks.shift();
  return chosen.id;
}

/** MENU screen track: respects the player's preference (a specific chosen track always wins).
 *  'dynamic'/no preference (the factory default) falls back to ONBOARDING_TRACK — the same
 *  welcome track used in the journey's first phase, not the reserved 'menu' track (bgm_menu.mp3):
 *  the menu screen has no "phase" to scale difficulty on, but it needs a sonic identity
 *  consistent with the rest of the onboarding. */
function selectMenuTrack(musicTrackPref?: string): MusicTrack {
  if (musicTrackPref && musicTrackPref !== 'dynamic'
      && MUSIC_TRACKS.some(t => t.id === musicTrackPref)) {
    return musicTrackPref;
  }
  return ONBOARDING_TRACK;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Every tube uses the lab test-tube silhouette. The shop cannot change it. */
function shapeSpecFor() {
  return TUBE_SHAPE_SPECS.proveta;
}

// QA/debug affordances are enabled ONLY on localhost (the dev server and `vite preview`), never on
// the public deploy. This keeps the fault-injection URL knobs + debug globals fully usable when
// testing locally while making them completely inert on GitHub Pages — so a crafted link
// (e.g. ?slowgen=999999999 or ?failgen=99) sent to a real player has no effect.
const IS_LOCAL = typeof window !== 'undefined'
  && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

// ── QA simulation params (loading/retry UX is impossible to see on fast machines otherwise) ──
//   ?slowgen=4000  → every level generation takes +4s (see the loading spinner / "taking long")
//   ?failgen=2     → the first 2 generations FAIL (see the error overlay; the retry then works)
//   ?prefetch=off  → disable next-level prefetch (A/B benchmark of the prefetch's UI-jank impact)
// slowgen/failgen also disable prefetching so the visible loading path is what actually runs.
const QA = new URLSearchParams(IS_LOCAL ? window.location.search : '');
const QA_SLOW_GEN_MS = Math.max(0, Number(QA.get('slowgen')) || 0);
let qaFailsLeft = Math.max(0, Number(QA.get('failgen')) || 0);
const QA_NO_PREFETCH = QA.get('prefetch') === 'off';
const QA_SIM_ACTIVE = QA_SLOW_GEN_MS > 0 || qaFailsLeft > 0;

// `?testupdate=1` — unlike the params above, this one is INTENTIONALLY NOT gated by IS_LOCAL:
// it only surfaces the "update installed" modal and, if tapped, reloads the page — both actions
// a real player could trigger harmlessly themselves (there's no degraded gameplay, no hidden
// data, nothing to sabotage by sharing the link). Left live on the public site on purpose, so
// the direction can test the real flow on a real phone against the deployed build, not just on
// localhost. Read directly from the URL (not the IS_LOCAL-gated `QA` object above).
const TEST_UPDATE_MODAL = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('testupdate') === '1';

/** UI-path generation: the real worker call wrapped with the QA simulation knobs above. */
function generateForUI(cfg: LevelConfig, maxAttempts?: number, seed?: number): Promise<GeneratedLevel> {
  let base: Promise<GeneratedLevel>;
  if (qaFailsLeft > 0) {
    qaFailsLeft--;
    base = Promise.reject(new Error('QA failgen'));
  } else {
    base = solverClient.generateLevel(cfg, maxAttempts, seed);
  }
  if (!QA_SLOW_GEN_MS) return base;
  return new Promise((resolve, reject) => {
    setTimeout(() => base.then(resolve, reject), QA_SLOW_GEN_MS);
  });
}

export function App() {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const wonHandled = useRef(false);
  const savedLevelRef = useRef<GeneratedLevel | null>(null);
  const sessionMetaRef = useRef({ mode: 'journey' as GameMode, phase: 0, optimalMoves: 0, bossId: undefined as string | undefined, parentPhase: undefined as number | undefined, journeyMode: undefined as JourneyMode | undefined });
  const coinHudRef = useRef<HTMLButtonElement>(null);
  const bossPhaseRef = useRef(0);
  const currentBossRef = useRef<BossData | null>(null);
  const journeyModeRef = useRef<JourneyMode>('balanced');
  const screenRef = useRef<Screen>('menu'); // read inside closures that must never see a stale screen (PWA update handler)
  const goMenuRef = useRef<() => void>(() => {});
  const savedSessionDataRef = useRef<GameSession | null>(null);

  // Persistence
  const [wallet, setWallet] = useState<Wallet>(() => loadWallet());
  const [previewBg, setPreviewBg] = useState<string | null>(null);
  const [journeyPhase, setJourneyPhase] = useState(() => loadProgress());
  const [, setDailyRecord] = useState<DailyRecord | null>(() => loadDaily());

  // Session state
  const [screen, setScreen] = useState<Screen>('menu');
  const [mode, setMode] = useState<GameMode>('journey');
  const [phase, setPhase] = useState(0);
  const [moves, setMoves] = useState(0);
  const [won, setWon] = useState(false);
  const [optimalMoves, setOptimalMoves] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Loader feedback (player-reported: occasional slow generations read as a freeze because the
  // old overlay sat BELOW the black transition fade — z-20 under z-40 — so nothing was visible):
  // genSlow shows a "taking longer…" note + retry button; genError offers retry/menu on failure.
  const [genSlow, setGenSlow] = useState(false);
  const [genError, setGenError] = useState(false);
  const [genTick, setGenTick] = useState(0); // bumps per load so the slow timer restarts on retry
  /** Invalidates in-flight generations: retry/menu bump it; stale .then results are dropped. */
  const genSeqRef = useRef(0);
  /** Re-runs the LAST requested load (journey/daily/boss) — wired to the retry buttons. */
  const retryLoadRef = useRef<null | (() => void)>(null);

  // ── Next-level PREFETCH ─────────────────────────────────────────────────────
  // While a phase is being played, the NEXT one is generated in the background so the transition
  // is instant. Jank-safety on weak phones, by construction:
  //  1. the generation itself runs in the solver Web Worker (another thread — never the UI);
  //  2. we only DISPATCH it 2.5s after the level loads, and via requestIdleCallback, so even the
  //     tiny postMessage cost lands on an idle main thread;
  //  3. prefetch is skipped entirely when the client is on the synchronous fallback (no Worker —
  //     there a "background" generation WOULD run on the main thread) and in QA sim modes;
  //  4. it is best-effort: a miss/failure just means the normal loading path generates as before.
  const prefetchedRef = useRef<{ key: string; level: GeneratedLevel } | null>(null);
  const prefetchTimerRef = useRef<number | null>(null);
  /** Epoch for prefetch cancellation. Bumped by cancelPrefetch AND by every new schedule, and
   *  captured at schedule time — a worker generation already in flight when the epoch changes must
   *  NOT write its result into prefetchedRef (clearTimeout can't recall an already-dispatched
   *  postMessage). This is what makes "leave the phase → prefetch stops" actually hold. */
  const prefetchSeqRef = useRef(0);

  const schedulePrefetch = useCallback((key: string, cfg: LevelConfig) => {
    if (QA_SIM_ACTIVE || QA_NO_PREFETCH || !solverClient.usingWorker) return;
    const pseq = ++prefetchSeqRef.current; // supersede any prior scheduled/in-flight prefetch
    if (prefetchTimerRef.current != null) clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = window.setTimeout(() => {
      prefetchTimerRef.current = null;
      const kick = () => {
        if (pseq !== prefetchSeqRef.current) return; // cancelled/superseded before dispatch
        // Gate on CONFIRMED high-end hardware at actual dispatch time (2.5s + idle after schedule),
        // not at schedule time: the Scene's weak-hardware detection is frame-count-driven and may
        // not have resolved yet early on (a CPU-throttle benchmark caught an earlier gate doing
        // nothing). isHighEndConfirmed is false while detection is still pending, so on weak OR
        // not-yet-measured hardware we skip — the player's stated preference is "wait a bit longer
        // to load" over "risk any jank while playing", even though generation runs in the worker.
        if (!sceneRef.current?.isHighEndConfirmed) return;
        // QA telemetry: record the dispatch (main-thread postMessage) and receipt (worker
        // reply crossing back to the main thread) so a benchmark can correlate prefetch
        // activity with long tasks / dropped frames. Inert in normal play (just an array push).
        const log = (window as unknown as { __prefetchLog?: Array<{ phase: string; t: number }> }).__prefetchLog;
        log?.push({ phase: 'dispatch', t: performance.now() });
        solverClient.generateLevel(cfg)
          .then((lvl) => {
            if (pseq !== prefetchSeqRef.current) return; // cancelled/superseded while the worker ran
            prefetchedRef.current = { key, level: lvl };
            log?.push({ phase: 'receive', t: performance.now() });
          })
          .catch(() => { /* best-effort — the normal path will generate on demand */ });
      };
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(kick, { timeout: 4000 });
      else kick();
    }, 2500);
  }, []);

  /** Consumes the prefetched level if it matches `key` (single-slot cache). */
  const takePrefetched = (key: string): GeneratedLevel | null => {
    const hit = prefetchedRef.current;
    if (hit && hit.key === key) {
      prefetchedRef.current = null;
      return hit.level;
    }
    return null;
  };

  /** Called when the player leaves the phase screen for the menu (goMenu, error recovery).
   *  A pending prefetch is otherwise harmless if left to fire — it is worker-only, and its
   *  single-slot cache is exact-key-matched (never misapplied to the wrong phase/mode) — but
   *  there is no reason to let a background generation run for a phase the player may never
   *  revisit. Cancelling here makes "leave the phase" deterministically stop any prefetch
   *  intent, instead of "it happens to fire in the background and gets used or discarded later". */
  const cancelPrefetch = () => {
    prefetchSeqRef.current++; // invalidate any generation already dispatched to the worker
    if (prefetchTimerRef.current != null) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
    prefetchedRef.current = null;
  };

  // Unmount safety: drop any pending prefetch timer so it can't fire against a dead component
  // (matters in dev StrictMode's double-mount; App is the root and rarely unmounts in production).
  useEffect(() => () => {
    if (prefetchTimerRef.current != null) clearTimeout(prefetchTimerRef.current);
  }, []);
  const [showShop, setShowShop] = useState(false);
  const [deadlocked, setDeadlocked] = useState(false);
  const [wonCoins, setWonCoins] = useState(0);
  const [showVictoryAnim, setShowVictoryAnim] = useState(false);
  const [pendingBoss, setPendingBoss] = useState<BossData | null>(null);
  const [bossActive, setBossActive] = useState(false);
  const [showAjustes, setShowAjustes] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [journeyMode] = useState<JourneyMode>('balanced');
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [toast, setToast] = useState<{ msg: string; id: number } | null>(null);
  // Visual pulse triggered by the Hint button when there are no moves (points to the way out).
  // May light up more than one button at once (e.g. Restart + Undo).
  const [hintNudge, setHintNudge] = useState<Array<'tube' | 'undo' | 'restart'>>([]);
  const [showWildTutorial, setShowWildTutorial] = useState(false);
  // PWA update, variant 'available' — an update is downloaded and waiting, offered while the
  // player is idle (menu) or deferred until they return there. `applyNow` is only ever populated
  // by the pwaRegister bridge (never invented locally) — calling it does skipWaiting + reload. A
  // phase in progress must never be interrupted (real field complaint, 2026-07-09: a silent
  // auto-reload used to fire mid-pour) — see updatePendingRef below.
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const updateApplyRef = useRef<null | (() => void)>(null);
  // Set when an update arrives while `screen === 'game'` — goMenu() checks this and shows the
  // modal only once it's actually safe to interrupt the player.
  const updatePendingRef = useRef(false);
  // power-up limits from scene (-1 = unlimited)
  const [undosLeft, setUndosLeft] = useState(-1);
  const [tubesLeft, setTubesLeft] = useState(2);
  const tubesLeftRef = useRef(2);
  const [tubeAd, setTubeAd] = useState(false);
  const [freeUndos, setFreeUndos] = useState(FREE_UNDOS);
  const [undoAd, setUndoAd] = useState(false);
  const [boardKey, setBoardKey] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const sumUndoRef = useRef<(() => void) | null>(null);
  const addColumnRef = useRef<(() => boolean) | null>(null);
  const shortAdRef = useRef(false);
  const cubeActiveRef = useRef(true);

  // keep refs in sync
  useEffect(() => { journeyModeRef.current = journeyMode; }, [journeyMode]);
  useEffect(() => { screenRef.current = screen; }, [screen]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = NativeApp.addListener('backButton', () => {
      if (screenRef.current === 'game') goMenuRef.current();
      else void NativeApp.exitApp();
    });
    return () => { void handle.then((listener) => listener.remove()); };
  }, []);

  // PWA update bridge: registers ONCE. pwaRegister calls this the moment a new version is ready
  // (any time after mount — could be seconds or hours later). At the menu, show the modal right
  // away; mid-game, defer it (updatePendingRef) until goMenu() decides it's safe. Shared by the
  // real registration, the localhost-only QA hook, and the public `?testupdate=1` trigger below —
  // all three must behave identically, so there's exactly one implementation.
  useEffect(() => {
    const onUpdateReady = (applyNow: () => void) => {
      updateApplyRef.current = applyNow;
      if (screenRef.current === 'game') updatePendingRef.current = true;
      else setShowUpdateModal(true);
    };
    setUpdateReadyHandler(onUpdateReady);
    // Debug/QA only (localhost, see IS_LOCAL): lets a test drive the exact "update ready" moment
    // without depending on a real Workbox/service-worker round-trip, which is notoriously flaky
    // to orchestrate in headless Chrome.
    if (IS_LOCAL) {
      (window as unknown as { __simulateUpdateReady: (applyNow: () => void) => void }).__simulateUpdateReady = onUpdateReady;
    }
    // `?testupdate=1` (see TEST_UPDATE_MODAL above) — works in ANY environment, including the
    // deployed site, so this can be tested on a real phone. applyNow does a genuine reload —
    // "instalar agora" is exactly as real as it would be for an actual update. Strip the param
    // right away (history.replaceState, no navigation) so that reload doesn't re-arm itself and
    // loop forever — a real update is driven by service-worker state, never by the URL, so a real
    // player's reload is always clean; this self-clearing only matters for manual testing.
    if (TEST_UPDATE_MODAL) {
      const url = new URL(window.location.href);
      url.searchParams.delete('testupdate');
      window.history.replaceState(null, '', url);
      // Never CLOBBER a real pending update (found in security review): if a genuine service
      // worker update resolved before this mount, setUpdateReadyHandler above already delivered
      // its applyNow (skipWaiting + reload) into updateApplyRef — replacing it with a bare
      // reload would leave the new worker stuck in `waiting`. The test trigger only arms itself
      // when nothing real is pending; a real update arriving LATER still overrides it (correct
      // direction: real wins).
      if (!updateApplyRef.current) onUpdateReady(() => window.location.reload());
    }

    // The old "Latest update" note is not shown. Still mark the build seen so it does not queue.
    const catchUp = resolveVersionCatchUp();
    if (catchUp === 'whats-new') markVersionSeen();
  }, []);

  // "No moves" toast when stuck (auto-dismisses after 3s)
  useEffect(() => {
    if (!deadlocked || won) { setToast(null); return; }
    setToast({ msg: t.hud.semMovimentosDisponiveis, id: Date.now() });
  }, [deadlocked, won, t]);

  // Auto-dismiss any toast (a new id restarts the timer)
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // The pulse on the button(s) suggested by the Hint lasts ~2.5s
  useEffect(() => {
    if (hintNudge.length === 0) return;
    const t = setTimeout(() => setHintNudge([]), 2500);
    return () => clearTimeout(t);
  }, [hintNudge]);

  // "Taking longer than expected" appears after 6s of generation; genTick restarts the timer on
  // retry (the boolean `generating` alone wouldn't re-run this effect for a retry mid-flight).
  useEffect(() => {
    if (!generating) { setGenSlow(false); return; }
    setGenSlow(false);
    const timer = setTimeout(() => setGenSlow(true), 6000);
    return () => clearTimeout(timer);
  }, [generating, genTick]);

  // Init the Pixi scene (once). Dev StrictMode mounts this effect twice; a second
  // Application on the same canvas drops WebGL and the context-lost handler reloads
  // the page, which looks like a crash and swallows button clicks.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const scene = new Scene();
    let cancelled = false;
    const onResize = () => { if (!cancelled) scene.relayout(); };
    const onVisibility = () => {
      if (cancelled) return;
      if (document.hidden) scene.pause(); else scene.resume();
    };

    const prefs0 = loadPrefs();
    const boot = sceneBoot.then(async () => {
      if (cancelled) return;
      await scene.init(canvas, prefs0.perfMode ?? 'auto');
      if (cancelled) {
        scene.release();
        return;
      }

      scene.onChange = (info) => {
        if (cubeActiveRef.current) return;
        setMoves(info.moves);
        setWon(info.won);
        setCanUndo(info.canUndo);
        setDeadlocked(info.deadlocked);
        setUndosLeft(info.undosLeft);
        setTubesLeft(info.tubesLeft);
        if (!info.won) {
          const meta = sessionMetaRef.current;
          const initState = savedLevelRef.current?.state;
          if (initState) {
            saveSession({
              mode: meta.mode, phase: meta.phase, optimalMoves: meta.optimalMoves,
              moves: info.moves,
              state: cloneState(scene.state),
              history: scene.currentHistory,
              initialState: initState,
              bossId: meta.bossId,
              parentPhase: meta.parentPhase,
              journeyMode: meta.mode === 'journey' && meta.phase !== -1 ? journeyModeRef.current : undefined,
            });
          }
        }
      };

      // Audio wiring
      scene.onPour = (dur) => { void audio.playPour(dur); };
      scene.onFlood = () => { void audio.playFlood(); };
      scene.onTubeComplete = (_tubeIdx, _color) => { void audio.playCapPop(); };

      // Wild tutorial: fires only once per app lifetime
      scene.onFirstWild = () => {
        const p = loadPrefs();
        if (!p.wildTutorialShown) {
          setShowWildTutorial(true);
        }
      };

      // Apply saved audio + UX prefs
      const prefs = loadPrefs();
      audio.musicOn = prefs.music;
      audio.sfxOn = prefs.sfx;
      if (prefs.sfxStyle) audio.sfxStyle = prefs.sfxStyle as typeof audio.sfxStyle;
      // Unlock audio on first user gesture
      const unlockAudio = () => { void audio.unlock(); };
      document.addEventListener('click', unlockAudio, { once: true });
      document.addEventListener('touchstart', unlockAudio, { once: true });

      sceneRef.current = scene;
      // Debug/QA globals — localhost only (see IS_LOCAL): not exposed on the public build.
      if (IS_LOCAL) {
        (window as unknown as { __scene: Scene }).__scene = scene;
        (window as unknown as { __audio: typeof audio }).__audio = audio;
        (window as unknown as { __solver: typeof solverClient }).__solver = solverClient;
      }
      window.addEventListener('resize', onResize);
      document.addEventListener('visibilitychange', onVisibility);

      // Apply saved theme + equipped tube shape
      const w = loadWallet();
      const bg = activeBg(w);
      const tube = activeTube(w);
      scene.setTheme(bg.deep, tube.rim);
      scene.setTubeShape(shapeSpecFor());

      // Check for in-progress session — show "Continuar" button, don't auto-navigate.
      // Boss sessions (phase === -1) now carry bossId + parentPhase so they can be
      // restored properly; a boss session missing bossId is stale/corrupt data and
      // is discarded instead of resumed into a broken state.
      const session = loadSession();
      if (session && session.phase === -1 && !session.bossId) {
        clearSession();
      } else if (session) {
        savedSessionDataRef.current = session;
        setHasSavedSession(true);
      }
      void audio.startMusic(selectMenuTrack(loadPrefs().musicTrack));
    });
    sceneBoot = boot.then(() => {}, () => {});

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (sceneRef.current === scene) {
        scene.release();
        sceneRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    sessionMetaRef.current = {
      mode, phase, optimalMoves,
      bossId: phase === -1 ? currentBossRef.current?.id : undefined,
      parentPhase: phase === -1 ? bossPhaseRef.current : undefined,
      journeyMode: mode === 'journey' && phase !== -1 ? journeyModeRef.current : undefined,
    };
  }, [mode, phase, optimalMoves]);

  /** "Menu" action of the generation-error overlay: cancels the failed load, clears every
   *  overlay that could pin a black screen, restores the normal theme, and lands on the menu.
   *  (The overlay itself already told the player what happened — no toast needed.) */
  const recoverFromGenerationFailure = useCallback(() => {
    genSeqRef.current++; // drop any in-flight generation result
    setGenError(false);
    setGenerating(false);
    setTransitioning(false);
    setWon(false);
    setPendingBoss(null);
    setBossActive(false);
    sceneRef.current?.disableBossMode();
    currentBossRef.current = null;
    cancelPrefetch();
    const w = loadWallet();
    sceneRef.current?.setTheme(activeBg(w).deep, activeTube(w).rim);
    setScreen('menu');
    void audio.startMusic(selectMenuTrack(loadPrefs().musicTrack));
  }, []);

  const loadJourneyPhase = useCallback((phaseIndex: number, jMode?: JourneyMode) => {
    const s = sceneRef.current;
    if (!s) return;
    const resolvedMode = jMode ?? journeyModeRef.current;
    retryLoadRef.current = () => loadJourneyPhase(phaseIndex, jMode);
    const seq = ++genSeqRef.current;
    setGenTick(x => x + 1);
    setGenError(false);
    setGenerating(true);
    setWon(false);
    setCanUndo(false);
    setDeadlocked(false);
    setWonCoins(0);
    setUndosLeft(-1);
    setTubesLeft(-1);
    wonHandled.current = false;
    const cfg = levelConfig(phaseIndex, resolvedMode);
    const applyLevel = (lvl: GeneratedLevel) => {
      savedLevelRef.current = lvl;
      s.moves = 0;
      setMoves(0);
      setPhase(phaseIndex);
      setOptimalMoves(lvl.optimalMoves);
      sessionMetaRef.current = { mode: 'journey', phase: phaseIndex, optimalMoves: lvl.optimalMoves, bossId: undefined, parentPhase: undefined, journeyMode: resolvedMode };
      s.setLevel(lvl.state, lvl.optimalMoves);
      const mCfg = MODES[resolvedMode];
      s.setPowerUpLimits(mCfg.maxUndos, mCfg.maxHints, mCfg.maxExtraTubes);
      setUndosLeft(mCfg.maxUndos);
      setTubesLeft(mCfg.maxExtraTubes);
      setGenerating(false);
      setTransitioning(false);
      // While this phase is played, quietly prepare the next one (see prefetch notes above).
      schedulePrefetch(`j:${phaseIndex + 1}:${resolvedMode}`, levelConfig(phaseIndex + 1, resolvedMode));
    };
    const cached = takePrefetched(`j:${phaseIndex}:${resolvedMode}`);
    if (cached) {
      applyLevel(cached); // instant transition — generated in the background during the last phase
      return;
    }
    generateForUI(cfg).then((lvl) => {
      if (seq !== genSeqRef.current) return; // superseded by a retry/menu — drop the stale level
      applyLevel(lvl);
    }).catch(() => {
      if (seq !== genSeqRef.current) return; // a newer load owns the UI now
      setGenerating(false);
      setTransitioning(false);
      setGenError(true); // overlay offers "try again" / menu — never a stuck black screen
    });
  }, [schedulePrefetch]);

  const loadDailyChallenge = useCallback(() => {
    const s = sceneRef.current;
    if (!s) return;
    retryLoadRef.current = () => loadDailyChallenge();
    const seq = ++genSeqRef.current;
    setGenTick(x => x + 1);
    setGenError(false);
    setGenerating(true);
    setWon(false);
    setCanUndo(false);
    setDeadlocked(false);
    setWonCoins(0);
    setUndosLeft(-1);
    setTubesLeft(-1);
    wonHandled.current = false;
    const seed = seedFromString('decanta-daily-' + todayStr());
    const cfg: LevelConfig = { colors: 7, capacity: 5, emptyTubes: 2, lockedTubes: 1, lockMoves: 4 };
    generateForUI(cfg, 200, seed).then((lvl) => {
      if (seq !== genSeqRef.current) return; // superseded by a retry/menu — drop the stale level
      savedLevelRef.current = lvl;
      s.moves = 0;
      setMoves(0);
      setPhase(0);
      setOptimalMoves(lvl.optimalMoves);
      sessionMetaRef.current = { mode: 'daily', phase: 0, optimalMoves: lvl.optimalMoves, bossId: undefined, parentPhase: undefined, journeyMode: undefined };
      s.setLevel(lvl.state, lvl.optimalMoves);
      // Daily always has unlimited help — without this, the Daily Challenge would inherit the
      // limits (e.g. Extreme = 0 undos / 3 hints / 0 tubes) left over from the last Journey
      // session, since setLevel() doesn't reset maxUndos/maxHints/maxExtraTubes, only the usage
      // counters.
      s.setPowerUpLimits(-1, -1, -1);
      setUndosLeft(-1);
      setTubesLeft(-1);
      setGenerating(false);
      setTransitioning(false); // parity with the journey/boss loaders — never leave the black fade up
    }).catch(() => {
      if (seq !== genSeqRef.current) return;
      setGenerating(false);
      setTransitioning(false);
      setGenError(true);
    });
  }, []);

  // Victory: reward + save progress + check for boss
  useEffect(() => {
    if (!won || wonHandled.current) return;
    wonHandled.current = true;
    clearSession();
    setHasSavedSession(false);
    savedSessionDataRef.current = null;

    if (cubeActiveRef.current) {
      const next = phase + 1;
      if (next < LEVEL_COUNT && next > loadProgress()) {
        saveProgress(next);
        setJourneyPhase(next);
      }
      const reward = coinsForLevel(phase + 1, LEVEL_COUNT);
      const newWallet = { ...wallet, coins: wallet.coins + reward };
      saveWallet(newWallet);
      setWallet(newWallet);
      setWonCoins(reward);
      setShowVictoryAnim(true);
      void audio.playVictory();
      return;
    }

    // ── Boss victory ──────────────────────────────────────────────────────
    if (bossActive && currentBossRef.current) {
      const boss = currentBossRef.current;
      currentBossRef.current = null;
      setBossActive(false);
      sceneRef.current?.disableBossMode();
      const reward = boss.reward;
      const newWallet = { ...wallet, coins: wallet.coins + reward };
      saveWallet(newWallet);
      setWallet(newWallet);
      setWonCoins(reward);
      if (reward > 0) setShowVictoryAnim(true);
      const bg = activeBg(newWallet);
      const tube = activeTube(newWallet);
      sceneRef.current?.setTheme(bg.deep, tube.rim);
      void audio.startMusic(selectTrackForPhase(bossPhaseRef.current + 1, false, loadPrefs().musicTrack));
      void audio.playVictory();
      return;
    }

    // ── Normal phase victory ──────────────────────────────────────────────
    const stars = starsFor(moves, optimalMoves);
    const helps = sceneRef.current?.helps ?? 0;
    const reward = rewardFor({ mode, stars, helps });

    if (mode === 'journey') {
      const next = phase + 1;
      if (next > journeyPhase) {
        setJourneyPhase(next);
        saveProgress(next);
      }

      const boss = bossAfterPhase(phase);
      if (boss) {
        bossPhaseRef.current = phase;
        if (reward > 0) {
          const newWallet = { ...wallet, coins: wallet.coins + reward };
          saveWallet(newWallet);
          setWallet(newWallet);
        }
        setPendingBoss(boss);
        return;
      }
    }

    // No boss — normal victory
    const newWallet = { ...wallet, coins: wallet.coins + reward };
    saveWallet(newWallet);
    setWallet(newWallet);
    setWonCoins(reward);
    if (reward > 0) setShowVictoryAnim(true);

    if (mode === 'daily') {
      const rec: DailyRecord = { date: todayStr(), stars, moves };
      saveDaily(rec);
      setDailyRecord(rec);
    }

    void audio.playVictory();
  }, [won]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBossFight = useCallback((boss: BossData) => {
    const s = sceneRef.current;
    if (!s) return;
    retryLoadRef.current = () => handleBossFight(boss);
    const seq = ++genSeqRef.current;
    setGenTick(x => x + 1);
    setGenError(false);
    currentBossRef.current = boss;
    setPendingBoss(null);
    setBossActive(true);
    void audio.playBossIntro();
    s.setTheme(boss.themeDeep, boss.rimColor);
    void audio.startMusic('boss');
    setGenerating(true);
    setWon(false);
    setCanUndo(false);
    setDeadlocked(false);
    setWonCoins(0);
    wonHandled.current = false;
    const applyLevel = (lvl: GeneratedLevel) => {
      savedLevelRef.current = lvl;
      s.moves = 0;
      setMoves(0);
      setPhase(-1);
      setOptimalMoves(lvl.optimalMoves);
      sessionMetaRef.current = {
        mode: 'journey', phase: -1, optimalMoves: lvl.optimalMoves,
        bossId: boss.id, parentPhase: bossPhaseRef.current, journeyMode: undefined,
      };
      s.setLevel(lvl.state, lvl.optimalMoves);
      const bossCfg = MODES.balanced;
      s.setPowerUpLimits(bossCfg.maxUndos, bossCfg.maxHints, bossCfg.maxExtraTubes);
      s.enableBossMode(boss.floodInterval, boss.floodCount);
      setGenerating(false);
      // While the boss is fought, prepare the phase that follows the victory.
      const nextPhaseIdx = bossPhaseRef.current + 1;
      schedulePrefetch(`j:${nextPhaseIdx}:${journeyModeRef.current}`, levelConfig(nextPhaseIdx, journeyModeRef.current));
    };
    const cached = takePrefetched(`b:${boss.id}`);
    if (cached) {
      applyLevel(cached); // generated in the background while the intro screen was showing
      return;
    }
    generateForUI(boss.levelConfig).then((lvl) => {
      if (seq !== genSeqRef.current) return; // superseded by a retry/menu — drop the stale level
      applyLevel(lvl);
    }).catch(() => {
      if (seq !== genSeqRef.current) return;
      setGenerating(false);
      setTransitioning(false);
      setGenError(true);
    });
  }, [schedulePrefetch]);

  // The boss INTRO screen is on for a few seconds while the player reads it — perfect window to
  // prefetch the boss board so "Enfrentar!" starts instantly.
  useEffect(() => {
    if (pendingBoss) schedulePrefetch(`b:${pendingBoss.id}`, pendingBoss.levelConfig);
  }, [pendingBoss, schedulePrefetch]);

  const onColumnMove = useCallback(() => {
    setMoves((count) => count + 1);
    void audio.playCubeMove();
  }, []);

  const onColumnSolved = useCallback(() => {
    setWon(true);
  }, []);

  const onColumnCanUndo = useCallback((can: boolean) => {
    setCanUndo(can);
  }, []);

  const onExtraReady = useCallback((left: number) => {
    tubesLeftRef.current = left;
    setTubesLeft(left);
  }, []);

  const beginCubeGame = () => {
    cubeActiveRef.current = true;
    setBoardKey((key) => key + 1);
    setPhase(Math.min(LEVEL_COUNT - 1, Math.max(0, loadProgress())));
    setMoves(0);
    setOptimalMoves(0);
    setWon(false);
    setDeadlocked(false);
    setCanUndo(false);
    setWonCoins(0);
    setPendingBoss(null);
    setBossActive(false);
    setGenerating(false);
    setTransitioning(false);
    setMode('journey');
    setScreen('game');
    tubesLeftRef.current = 2;
    setTubesLeft(2);
    setFreeUndos(FREE_UNDOS);
    wonHandled.current = false;
    void loadRewardedAds();
    void audio.startMusic(selectTrackForPhase(0, false, loadPrefs().musicTrack));
  };

  const replayColumns = () => {
    setWon(false);
    setDeadlocked(false);
    setCanUndo(false);
    setMoves(0);
    setWonCoins(0);
    wonHandled.current = false;
    tubesLeftRef.current = 2;
    setTubesLeft(2);
    setFreeUndos(FREE_UNDOS);
    setResetKey((key) => key + 1);
  };

  const nextColumns = () => {
    const advance = () => {
      setWon(false);
      setDeadlocked(false);
      setCanUndo(false);
      setMoves(0);
      setWonCoins(0);
      wonHandled.current = false;
      tubesLeftRef.current = 2;
      setTubesLeft(2);
      setFreeUndos(FREE_UNDOS);
      setPhase((current) => {
        const next = current + 1;
        if (next >= LEVEL_COUNT) return current;
        const unlocked = Math.max(loadProgress(), next);
        saveProgress(unlocked);
        setJourneyPhase(unlocked);
        return next;
      });
    };
    if ((phase + 1) % 3 !== 0) {
      advance();
      return;
    }
    if (shortAdRef.current) return;
    shortAdRef.current = true;
    void showShortAd().finally(() => {
      shortAdRef.current = false;
      advance();
    });
  };

  const startJourney = () => {
    beginCubeGame();
  };

  const continueSession = () => {
    beginCubeGame();
  };

  const restart = () => {
    if (cubeActiveRef.current) {
      replayColumns();
      return;
    }
    const s = sceneRef.current;
    const saved = savedLevelRef.current;
    if (!s || !saved) return;
    setWon(false);
    setCanUndo(false);
    setDeadlocked(false);
    setWonCoins(0);
    wonHandled.current = false;
    s.moves = 0;
    setMoves(0);
    if (bossActive && currentBossRef.current) {
      s.setLevel(saved.state, saved.optimalMoves);
      const bossCfg = MODES.balanced;
      s.setPowerUpLimits(bossCfg.maxUndos, bossCfg.maxHints, bossCfg.maxExtraTubes);
      s.enableBossMode(currentBossRef.current.floodInterval, currentBossRef.current.floodCount);
    } else if (mode === 'daily') {
      // Daily is always unlimited — doesn't use journeyModeRef (which could be 'extreme' from a
      // previous Journey session and would wrongly restrict Daily on restart).
      s.setLevel(saved.state, saved.optimalMoves);
      s.setPowerUpLimits(-1, -1, -1);
    } else {
      s.setLevel(saved.state, saved.optimalMoves);
      const mCfg = MODES[journeyModeRef.current];
      s.setPowerUpLimits(mCfg.maxUndos, mCfg.maxHints, mCfg.maxExtraTubes);
    }
  };

  const skipPhase = () => {
    if (!import.meta.env.DEV || Capacitor.isNativePlatform()) return;
    if (cubeActiveRef.current) {
      nextColumns();
      return;
    }
    nextPhase();
  };

  const nextPhase = () => {
    if (cubeActiveRef.current) {
      nextColumns();
      return;
    }
    clearSession();
    setHasSavedSession(false);
    savedSessionDataRef.current = null;
    setBossActive(false);
    sceneRef.current?.disableBossMode();
    currentBossRef.current = null;
    const targetPhase = phase === -1 ? bossPhaseRef.current + 1 : phase + 1;
    setTransitioning(true);
    setTimeout(() => {
      void audio.startMusic(selectTrackForPhase(targetPhase, false, loadPrefs().musicTrack));
      loadJourneyPhase(targetPhase);
    }, 320);
  };

  const goMenu = () => {
    // Only clear the saved session when the phase has already been won or there's no progress
    // to preserve. A normal exit (the '←' button) mid-phase should keep the session so the
    // 'Continue' card shows up on the menu.
    if (won || moves === 0) {
      clearSession();
      setHasSavedSession(false);
      savedSessionDataRef.current = null;
    } else {
      // Session in progress: reload from localStorage (written on every move by onChange) so the
      // 'Continue' card appears immediately on this visit to the menu — previously this state was
      // only read at boot, requiring an F5 for the card to appear.
      const session = loadSession();
      if (session && !(session.phase === -1 && !session.bossId)) {
        savedSessionDataRef.current = session;
        setHasSavedSession(true);
      }
    }
    // An update arrived while a phase was in progress — it was deferred (never interrupt
    // mid-game); now that the player is back at the menu on their own, it's safe to tell them.
    if (updatePendingRef.current) {
      updatePendingRef.current = false;
      setShowUpdateModal(true);
    }
    setBossActive(false);
    sceneRef.current?.disableBossMode();
    currentBossRef.current = null;
    setPendingBoss(null);
    setScreen('menu');
    setTransitioning(false);
    setDeadlocked(false);
    // Cancel any in-flight generation: its .then must not repaint the board under the menu.
    genSeqRef.current++;
    setGenerating(false);
    setGenError(false);
    cancelPrefetch();
    void audio.startMusic(selectMenuTrack(loadPrefs().musicTrack));
    if (phase === -1) {
      const w = loadWallet();
      const bg = activeBg(w);
      const tube = activeTube(w);
      sceneRef.current?.setTheme(bg.deep, tube.rim);
    }
  };
  goMenuRef.current = goMenu;

  const handleUndo = () => {
    if (cubeActiveRef.current) {
      if (!canUndo || undoAd) return;
      if (freeUndos > 0) {
        setFreeUndos((left) => left - 1);
        sumUndoRef.current?.();
        return;
      }
      if (wallet.coins >= UNDO_COIN_PRICE) {
        const next = { ...wallet, coins: wallet.coins - UNDO_COIN_PRICE };
        setWallet(next);
        saveWallet(next);
        sumUndoRef.current?.();
        return;
      }
      setUndoAd(true);
      void showRewardedAd().then((watched) => {
        setUndoAd(false);
        if (watched) {
          sumUndoRef.current?.();
          return;
        }
        setToast({ msg: t.hud.anuncioDesfazer, id: Date.now() });
      });
      return;
    }
    sceneRef.current?.undo();
  };

  const spendLevelTube = () => {
    if (tubesLeftRef.current <= 0) return false;
    if (!addColumnRef.current?.()) return false;
    tubesLeftRef.current -= 1;
    setTubesLeft(tubesLeftRef.current);
    return true;
  };

  const handleAddTube = () => {
    if (!cubeActiveRef.current) {
      sceneRef.current?.addEmptyTube();
      return;
    }
    if (tubeAd || tubesLeftRef.current <= 0) return;
    if (wallet.freeTubes > 0) {
      if (!spendLevelTube()) return;
      const next = { ...wallet, freeTubes: wallet.freeTubes - 1 };
      setWallet(next);
      saveWallet(next);
      return;
    }
    if (wallet.coins >= TUBE_COIN_PRICE) {
      if (!spendLevelTube()) return;
      const next = { ...wallet, coins: wallet.coins - TUBE_COIN_PRICE };
      setWallet(next);
      saveWallet(next);
      return;
    }
    setTubeAd(true);
    void showRewardedAd().then((watched) => {
      setTubeAd(false);
      if (watched) {
        spendLevelTube();
        return;
      }
      setToast({ msg: t.hud.anuncioTubo, id: Date.now() });
    });
  };

  const grantAdCoins = async () => {
    const watched = await showRewardedAd();
    if (!watched) return false;
    setWallet((w) => {
      const next = { ...w, coins: w.coins + 10 };
      saveWallet(next);
      return next;
    });
    return true;
  };

  /** Applies a wallet's equipped cosmetics to the scene: background + glass color (theme) and
   *  the tube silhouette (shape). No-op during a boss fight (which uses its own theme). */
  const applyCosmetics = (w: Wallet) => {
    if (bossActive) return;
    const bg = activeBg(w);
    const tube = activeTube(w);
    sceneRef.current?.setTheme(bg.deep, tube.rim);
    sceneRef.current?.setTubeShape(shapeSpecFor());
  };

  const handleBuyOrEquip = (item: ShopItem) => {
    let w = { ...wallet };
    if (item.price > 0 && !w.owned.includes(item.id)) {
      if (w.coins < item.price) return;
      w = { ...w, coins: w.coins - item.price, owned: [...w.owned, item.id] };
    }
    if (item.kind === 'bg') w = { ...w, bg: item.id };
    else if (item.kind === 'tube') w = { ...w, tube: item.id };
    else return;
    saveWallet(w);
    setWallet(w);
    setPreviewBg(null);
    applyCosmetics(w);
  };

  const handlePreview = (item: ShopItem) => {
    if (bossActive || item.kind === 'shape') return;
    if (item.kind === 'bg') setPreviewBg(item.id);
    const bg = item.kind === 'bg' ? activeBg({ ...wallet, bg: item.id }) : activeBg(wallet);
    const tube = item.kind === 'tube' ? activeTube({ ...wallet, tube: item.id }) : activeTube(wallet);
    sceneRef.current?.setTheme(bg.deep, tube.rim);
  };

  const handleShopClose = () => {
    setPreviewBg(null);
    applyCosmetics(wallet); // revert any un-purchased preview back to what's equipped
    setShowShop(false);
  };

  const isBoss = phase === -1;
  const bossText = (b: BossData) => t.boss[b.id as keyof typeof t.boss];
  const label = isBoss
    ? (currentBossRef.current ? bossText(currentBossRef.current).title : t.hud.chefao)
    : mode === 'daily' ? t.hud.diario : diffLabel(phase, (key) => t.levels[key]);

  // Power-up button labels: show remaining count when limited
  const undoLabel = cubeActiveRef.current
    ? (freeUndos > 0 ? t.hud.voltar(freeUndos) : t.hud.desfazerMoeda(UNDO_COIN_PRICE))
    : t.hud.voltar(undosLeft);
  const tubeLabel = t.hud.maisTubo(cubeActiveRef.current && wallet.freeTubes > 0 ? wallet.freeTubes : tubesLeft);

  const showVictoryModal = won && !generating && screen === 'game' && !pendingBoss;

  const trulyStuck = !cubeActiveRef.current && deadlocked && !canUndo && tubesLeft === 0 && !won;

  return (
    <>
      {/* Canvas always mounted — Pixi lives here */}
      <canvas
        id="game-canvas"
        ref={canvasRef}
        className="pointer-events-none opacity-0"
      />
      {screen === 'game' && (
        <SumColumns
          key={`${phase}-${boardKey}`}
          level={phase}
          resetKey={resetKey}
          undoRef={sumUndoRef}
          addColumnRef={addColumnRef}
          onMove={onColumnMove}
          onSolved={onColumnSolved}
          onCanUndo={onColumnCanUndo}
          onExtraReady={onExtraReady}
        />
      )}

      {/* ── PHASE TRANSITION FADE ────────────────────────────────── */}
      <div
        className="pointer-events-none fixed inset-0 z-40 bg-black transition-opacity duration-300"
        style={{ opacity: transitioning ? 1 : 0 }}
      />

      {/* ── TOAST (global: "no moves" in-game, generation-failure recovery on the menu) ── */}
      <div
        className={`pointer-events-none fixed left-1/2 z-30 -translate-x-1/2 rounded-xl bg-slate-800/95 px-4 py-2 text-xs font-medium text-amber-300 shadow-lg backdrop-blur transition-all duration-300 ${
          toast ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ bottom: 'calc(5.5rem + var(--ad-banner-offset, 0px))' }}
      >
        {toast?.msg ?? t.hud.semMovimentosDisponiveis}
      </div>

      {/* ── MENU ─────────────────────────────────────────────────────── */}
      {screen === 'menu' && (
        <div
          className="pointer-events-auto fixed inset-0 z-10 overflow-y-auto bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/bg/menu.jpg')" }}
        >
          <div
            className="fixed inset-x-3 z-20 flex items-center justify-between"
            style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
          >
            <SettingsPill label={t.ajustes.title} onClick={() => setShowAjustes(true)} />
            <CoinPill coins={wallet.coins} onClick={() => setShowShop(true)} />
          </div>

          <img
            src="/brand/logo.png"
            alt={t.menu.appTitle}
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-[-30px] z-10 w-[min(92vw,480px)] -translate-x-1/2 select-none"
          />
          <div
            className="flex min-h-full flex-col items-center px-4"
            style={{
              paddingTop: 'calc(min(92vw, 480px) * 0.66)',
              paddingBottom: 'calc(2rem + var(--ad-banner-offset, 0px))',
            }}
          >
            <div className="flex-1" />

            <div className="flex w-full max-w-xs flex-col gap-3">
              {hasSavedSession && savedSessionDataRef.current ? (
                <>
                  {/* PRIMARY: Continue (saved session) — full teal, larger */}
                  <button
                    onClick={continueSession}
                    className="flex flex-col items-start rounded-2xl bg-teal-400 px-5 py-5 text-left shadow-lg transition active:scale-95"
                  >
                    <span className="text-lg font-bold text-slate-900">▶ {t.menu.continuar}</span>
                    <span className="mt-0.5 text-sm font-medium text-slate-900/70">
                      {savedSessionDataRef.current.mode === 'daily' ? t.menu.diario :
                        savedSessionDataRef.current.phase === -1 ? t.menu.batalhaDeChefao :
                        `${t.menu.fase(savedSessionDataRef.current.phase + 1)} · ${t.common.jogadas(savedSessionDataRef.current.moves)}`}
                    </span>
                  </button>
                  {/* SECONDARY: Journey */}
                  <button
                    onClick={startJourney}
                    className="flex items-center justify-between rounded-2xl bg-slate-800/80 px-5 py-3.5 text-left shadow-lg transition active:scale-95"
                  >
                    <span className="text-base font-semibold text-slate-100">{t.menu.jornada}</span>
                  </button>
                </>
              ) : (
                /* PRIMARY: Play/Journey (no session) */
                <button
                  onClick={startJourney}
                  aria-label={`${t.v2.jogar} ${t.menu.fase(journeyPhase + 1)}`}
                  className="relative w-[80%] self-center transition active:scale-95"
                >
                  <img src="/ui/play.svg?v=3" alt="" draggable={false} className="w-full select-none" />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center pb-[6%] text-[clamp(1.08rem,5vw,1.52rem)] font-extrabold tracking-wide text-[#F9F2DD] [text-shadow:0_2px_0_#003500]">
                    {t.menu.fase(journeyPhase + 1)}
                  </span>
                </button>
              )}
            </div>

            <div className="flex-1" />
          </div>
        </div>
      )}

      {/* ── HUD (in-game only) ───────────────────────────────────────── */}
      {screen === 'game' && (
        <>
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: bgBackdrop(activeBg(previewBg ? { ...wallet, bg: previewBg } : wallet)) }}
          />
          {/* Menu left, level centered, coins on the right. */}
          <div id="hud-top" className="pointer-events-none fixed inset-x-0 top-0 z-10 flex flex-col gap-1.5 px-3 pt-[env(safe-area-inset-top)]">
            <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="justify-self-start">
                <MenuButton label={t.common.menu} onClick={goMenu} />
              </div>
              <div className="flex h-10 min-w-0 items-center truncate rounded-xl bg-slate-900/75 px-2.5 text-sm backdrop-blur">
                <span className="font-semibold text-slate-100">
                  {isBoss ? (currentBossRef.current ? bossText(currentBossRef.current).name : t.hud.chefao) : mode === 'daily' ? t.hud.diario : t.hud.fase(phase + 1)}
                </span>
                {mode !== 'daily' && (
                  <span className={isBoss ? 'text-red-300' : 'text-slate-300'}>
                    {' · '}{label}
                  </span>
                )}
                {isBoss && bossActive && (
                  <span className="text-red-300">{' · '}{t.hud.chefaoTag}</span>
                )}
              </div>
              <div className="justify-self-end">
                <CoinPill coins={wallet.coins} onClick={() => setShowShop(true)} innerRef={coinHudRef} />
              </div>
            </div>
          </div>

          {/* Footer — Undo · Hint · +Tube · Restart · Skip (classic size, Restart back). */}
          <div
            id="hud-bottom"
            className="fixed inset-x-0 bottom-0 z-10 flex justify-center"
            style={{ paddingBottom: 'calc(max(1rem, env(safe-area-inset-bottom)) + var(--ad-banner-offset, 0px))' }}
          >
            <div className="flex items-center gap-2 rounded-2xl bg-slate-900/85 px-3 py-2.5 shadow-xl backdrop-blur">
              <ActionButton
                onClick={handleUndo}
                pulse={hintNudge.includes('undo')}
                disabled={cubeActiveRef.current ? (!canUndo || undoAd) : (!canUndo || undosLeft === 0 || undoAd)}
                dimmed={cubeActiveRef.current ? (!canUndo || undoAd) : (!canUndo || undosLeft === 0 || undoAd)}
              >
                {cubeActiveRef.current && freeUndos <= 0 && canUndo && !undoAd ? (
                  <span className="inline-flex items-center gap-0.5">
                    {t.hud.voltar(-1)}
                    <CoinIcon className="h-3.5 w-3.5" />
                    <span className="text-amber-300">{UNDO_COIN_PRICE}</span>
                  </span>
                ) : (
                  cubeActiveRef.current && freeUndos <= 0 ? t.hud.voltar(-1) : undoLabel
                )}
              </ActionButton>
              <ActionButton
                onClick={handleAddTube}
                pulse={(deadlocked && !won && tubesLeft !== 0) || hintNudge.includes('tube')}
                disabled={tubesLeft === 0 || tubeAd}
                dimmed={tubesLeft === 0 || tubeAd}
              >
                {cubeActiveRef.current && wallet.freeTubes <= 0 && tubesLeft > 0 ? (
                  <span className="inline-flex items-center gap-0.5">
                    {t.hud.maisTubo(-1)}
                    <CoinIcon className="h-3.5 w-3.5" />
                    <span className="text-amber-300">{TUBE_COIN_PRICE}</span>
                  </span>
                ) : (
                  tubeLabel
                )}
              </ActionButton>
              <ActionButton onClick={restart} pulse={hintNudge.includes('restart')}>{t.common.reiniciar}</ActionButton>
              {import.meta.env.DEV && !Capacitor.isNativePlatform() && mode === 'journey' && !won && (
                <ActionButton onClick={skipPhase}>{t.hud.pular}</ActionButton>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── "STUCK WITH NO WAY OUT" MODAL ─────────────────────────────── */}
      {trulyStuck && screen === 'game' && !generating && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="flex max-h-[85dvh] flex-col items-center gap-4 overflow-y-auto overscroll-contain rounded-2xl bg-slate-900/95 px-7 py-6 text-center shadow-2xl">
            <div className="text-lg font-bold text-amber-300">{t.hud.semMovimentosTitulo}</div>
            <div className="text-sm text-slate-400">{t.hud.naoHaMaisJogadas}</div>
            <div className="flex gap-2">
              <button
                onClick={restart}
                className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition active:scale-95"
              >
                {t.common.reiniciar}
              </button>
              <button
                onClick={goMenu}
                className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition active:scale-95"
              >
                {t.common.menu}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── GENERATING / ERROR OVERLAY ───────────────────────────────────
          z-50 ON PURPOSE: the phase-transition fade is a SOLID black layer at z-40 — a lower
          overlay would sit underneath it, so on slower devices a transition looked like a frozen
          black screen with no feedback (real player report). This must win. */}
      {(generating || genError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="flex w-full max-w-[17rem] flex-col items-center gap-4 rounded-2xl bg-slate-900/95 px-7 py-6 text-center shadow-2xl">
            {!genError ? (
              <>
                <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-slate-700 border-t-teal-400" />
                <div className="text-sm font-medium text-slate-200">
                  {isBoss || bossActive ? t.hud.preparandoBatalha : t.hud.preparandoFase}
                </div>
                {genSlow && (
                  <>
                    <div className="text-xs text-slate-500">{t.hud.carregandoLento}</div>
                    <button
                      onClick={() => retryLoadRef.current?.()}
                      className="w-full rounded-xl bg-slate-700 py-2.5 text-sm font-medium text-slate-200 transition active:scale-95"
                    >
                      {t.hud.tentarNovamente}
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-amber-300">{t.hud.erroPreparandoFase}</div>
                <div className="flex w-full flex-col gap-2">
                  <button
                    onClick={() => { setGenError(false); retryLoadRef.current?.(); }}
                    className="w-full rounded-xl bg-teal-400 py-2.5 text-sm font-semibold text-slate-900 transition active:scale-95"
                  >
                    {t.hud.tentarNovamente}
                  </button>
                  <button
                    onClick={recoverFromGenerationFailure}
                    className="w-full rounded-xl bg-slate-700 py-2.5 text-sm font-medium text-slate-200 transition active:scale-95"
                  >
                    {t.common.menu}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── BOSS INTRO ───────────────────────────────────────────────── */}
      {pendingBoss && (
        <BossIntroScreen
          boss={pendingBoss}
          onFight={() => handleBossFight(pendingBoss)}
          onFlee={() => {
            setPendingBoss(null);
            setWon(false);
            setScreen('menu');
            void audio.startMusic(selectMenuTrack(loadPrefs().musicTrack));
          }}
        />
      )}

      {/* ── VICTORY MODAL ────────────────────────────────────────────── */}
      {showVictoryModal && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className="flex max-h-[85dvh] flex-col items-center gap-5 overflow-y-auto overscroll-contain rounded-2xl bg-slate-900/95 px-8 py-7 text-center shadow-2xl">
            <div className={`text-2xl font-bold tracking-wide ${isBoss ? 'text-red-300' : 'text-amber-300'}`}>
              {isBoss ? t.hud.chefaoDerrotado : t.hud.decantado}
            </div>

            <div className="text-sm text-slate-400">
              {t.common.jogadas(moves)}{optimalMoves > 0 && !isBoss && ` · ${t.hud.otimoInline(optimalMoves)}`}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={restart}
                className="relative h-9 transition active:scale-95"
              >
                <img src="/ui/retry.svg" alt="" draggable={false} className="h-9 w-auto select-none" />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-[#F9F2DD] [text-shadow:0_2px_0_#320903]">
                  {t.hud.repetir}
                </span>
              </button>
              {mode === 'journey' && phase + 1 < LEVEL_COUNT && (
                <button
                  onClick={nextPhase}
                  className="relative h-9 transition active:scale-95"
                >
                  <img src="/ui/next.svg" alt="" draggable={false} className="h-9 w-auto select-none" />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold text-[#F9F2DD] [text-shadow:0_2px_0_#003500]">
                    {t.hud.proxima}
                  </span>
                </button>
              )}
              {mode !== 'journey' && (
                <button
                  onClick={goMenu}
                  className="rounded-xl bg-teal-400 px-5 py-2 text-sm font-semibold text-slate-900 transition active:scale-95"
                >
                  {t.common.menu}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── VICTORY ANIMATION ────────────────────────────────────────── */}
      {showVictoryAnim && (
        <VictoryAnim
          amount={wonCoins}
          coinRef={coinHudRef}
          onComplete={() => setShowVictoryAnim(false)}
        />
      )}

      {/* ── SHOP ─────────────────────────────────────────────────────── */}
      {showShop && (
        <ShopModal
          wallet={wallet}
          onBuyOrEquip={handleBuyOrEquip}
          onPreview={handlePreview}
          onWatchAd={grantAdCoins}
          onClose={handleShopClose}
        />
      )}

      {/* ── SETTINGS ─────────────────────────────────────────────────── */}
      {showAjustes && (
        <AjustesModal onClose={() => setShowAjustes(false)} />
      )}

      {/* ── WILD TUTORIAL ────────────────────────────────────────────── */}
      {showWildTutorial && screen === 'game' && (
        <WildTutorial
          onDismiss={() => {
            setShowWildTutorial(false);
            savePrefs({ ...loadPrefs(), wildTutorialShown: true });
          }}
        />
      )}

      {/* ── PWA UPDATE — 'available' takes priority over 'whatsNew' if both were somehow true
          at once (shouldn't happen by construction, but 'available' is the actionable one). ── */}
      {showUpdateModal && screen === 'menu' && (
        <UpdateReadyModal
          variant="available"
          notes={t.updateReady.notas}
          onClose={() => setShowUpdateModal(false)}
          onInstallNow={() => {
            markInstallPending();
            updateApplyRef.current?.();
          }}
        />
      )}
    </>
  );
}

function ActionButton({
  onClick,
  disabled = false,
  dimmed = false,
  pulse = false,
  big = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  dimmed?: boolean;
  pulse?: boolean;
  big?: boolean; // larger targets (~56px) — recommended mobile touch floor
  children: React.ReactNode;
}) {
  const size = big ? 'h-14 min-w-[3.75rem] text-sm' : 'h-10 min-w-[3.25rem] text-xs';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex ${size} items-center justify-center rounded-xl bg-slate-700/85 px-3 font-medium text-slate-200 shadow transition active:scale-95 disabled:cursor-not-allowed${dimmed ? ' opacity-30' : ''}${pulse ? ' animate-pulse ring-2 ring-teal-400 ring-offset-1 ring-offset-slate-900/0' : ''}`}
    >
      {children}
    </button>
  );
}

/** Coin pill with an amber "+" — a "tap to buy" affordance (shop). Used in the menu and the HUD.
 *  The HUD's `innerRef` is the target that VictoryAnim aims at (the flying coin).
 *  The "+" is an SVG (two strokes), not the '+' character: the text glyph ends up OFF-CENTER on
 *  desktop because its vertical position within the line box depends on font metrics (Segoe UI on
 *  Windows ≠ the phone's font). The SVG is pixel-perfect on any platform. */
function CoinPill({ coins, onClick, innerRef }: { coins: number; onClick: () => void; innerRef?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={innerRef}
      onClick={onClick}
      className="pointer-events-auto flex h-10 items-center gap-1.5 rounded-xl bg-slate-900/75 px-2.5 text-sm font-semibold text-amber-300 backdrop-blur transition active:scale-95"
    >
      <CoinIcon className="h-5 w-5" />
      <span className="tabular-nums">{coins}</span>
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-slate-900">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
    </button>
  );
}

/** Home-screen settings pill — gold gear + label, mirroring the coin pill on the right. */
function SettingsPill({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="pointer-events-auto flex h-10 items-center gap-1.5 rounded-xl bg-slate-900/75 px-2.5 text-sm shadow-[0_0_16px_rgba(251,191,36,0.32)] backdrop-blur transition duration-300 hover:shadow-[0_0_22px_rgba(251,191,36,0.5)] active:scale-95"
    >
      <img src="/ui/settings.svg?v=2" alt="" draggable={false} className="h-5 w-5 shrink-0 select-none object-contain" />
      <span className="font-extrabold tracking-wide text-amber-300">{label}</span>
    </button>
  );
}

/** In-game HUD "Menu" button — a menu icon (☰) that goes STRAIGHT to the home screen without
 *  asking anything (no pause overlay by design). The pulse covers the deadlock case. */
function MenuButton({ onClick, label, pulse = false }: { onClick: () => void; label: string; pulse?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`pointer-events-auto flex h-10 items-center gap-1.5 rounded-xl bg-slate-900/75 px-2.5 text-sm font-semibold text-slate-100 backdrop-blur transition active:scale-90${pulse ? ' animate-pulse ring-2 ring-teal-400' : ''}`}
    >
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
      <span>{label}</span>
    </button>
  );
}

const CONFETTI_COLORS = ['#ef4444','#22c55e','#3b82f6','#eab308','#f97316','#a855f7','#06b6d4','#ec4899'];

function VictoryAnim({
  amount,
  coinRef,
  onComplete,
}: {
  amount: number;
  coinRef: React.RefObject<HTMLButtonElement | null>;
  onComplete: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const tl = gsap.timeline({ onComplete });

    const particles = Array.from({ length: 28 }, (_, i) => {
      const el = document.createElement('div');
      const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      el.style.cssText = `position:absolute;width:10px;height:7px;border-radius:2px;left:50%;top:50%;transform:translate(-50%,-50%);background:${color};pointer-events:none`;
      container.appendChild(el);
      return el;
    });

    particles.forEach((el, i) => {
      const angle = (i / particles.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const dist = 90 + Math.random() * 110;
      tl.to(el, {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist - 60,
        rotation: Math.random() * 720 - 360,
        opacity: 0,
        duration: 1.1 + Math.random() * 0.4,
        ease: 'power2.out',
      }, 0);
    });

    const badge = document.createElement('div');
    badge.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(0);display:inline-flex;align-items:center;gap:8px;background:#fbbf24;color:#1e293b;font-size:1.6rem;font-weight:800;padding:10px 28px;border-radius:18px;box-shadow:0 4px 28px rgba(251,191,36,0.55);white-space:nowrap;pointer-events:none`;
    badge.textContent = `+${amount}`;
    const coin = document.createElement('img');
    coin.src = '/ui/coin.png';
    coin.alt = '';
    coin.draggable = false;
    coin.style.cssText = 'display:block;height:1.15em;width:1.15em;object-fit:contain;flex:none';
    badge.appendChild(coin);
    container.appendChild(badge);

    tl.to(badge, { scale: 1, duration: 0.38, ease: 'back.out(1.7)' }, 0.05);

    tl.add(() => {
      const rect = coinRef.current?.getBoundingClientRect();
      if (rect) {
        const tx = rect.left + rect.width / 2 - window.innerWidth / 2;
        const ty = rect.top + rect.height / 2 - window.innerHeight / 2;
        gsap.to(badge, { x: tx, y: ty, scale: 0.35, opacity: 0, duration: 0.55, ease: 'power2.in' });
      } else {
        gsap.to(badge, { y: -120, opacity: 0, duration: 0.5, ease: 'power2.in' });
      }
    }, 1.15);

    return () => {
      tl.kill();
      particles.forEach(el => el.remove());
      badge.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className="pointer-events-none fixed inset-0 z-50" />;
}
