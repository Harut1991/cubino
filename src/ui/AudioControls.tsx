import { useState } from 'react';
import { audio, MUSIC_TRACKS, SFX_OPTIONS } from '../audio/engine';
import type { SfxStyle, MusicTrack, MusicTrackInfo, SfxOption } from '../audio/engine';
import { loadPrefs, savePrefs } from '../game/settings';
import { CategoryPicker } from './CategoryPicker';
import { useT } from '../i18n/context';

/**
 * AUDIO controls (music + effects) — toggles and pickers. Extracted from SoundSettings so it can be
 * reused in TWO places: the standalone Sound modal (classic layout) and the "Audio" section inside
 * Settings (v2 layout, where Sound was merged into Settings). No modal chrome — just the core.
 */
export function AudioControls() {
  const t = useT();
  const [prefs, setPrefs] = useState(() => loadPrefs());

  const DYNAMIC_TRACK: MusicTrackInfo = {
    id: 'dynamic',
    name: t.sound.dinamico,
    artist: t.sound.mudaComADificuldadeDaFase,
    style: '',
    mood: 'calm',
    file: '',
  };
  const musicPickerItems: MusicTrackInfo[] = [DYNAMIC_TRACK, ...MUSIC_TRACKS];

  const update = (partial: Partial<typeof prefs>) => {
    const next = { ...prefs, ...partial };
    setPrefs(next);
    savePrefs(next);
    if (partial.music !== undefined) void audio.setMusicOn(partial.music);
    if (partial.sfx !== undefined) audio.sfxOn = partial.sfx;
    if (partial.sfxStyle !== undefined) {
      audio.sfxStyle = partial.sfxStyle as SfxStyle;
      void audio.previewSfx(partial.sfxStyle as SfxStyle);
    }
    if (partial.musicTrack !== undefined) {
      audio.setMusicTrackPref(partial.musicTrack as MusicTrack | 'dynamic');
      if (partial.musicTrack !== 'dynamic' && next.music) {
        void audio.startMusic(partial.musicTrack as MusicTrack);
      }
    }
  };

  const activeMusicTrack = prefs.musicTrack ?? 'dynamic';

  return (
    <>
      {/* Music toggle */}
      <div className="mb-3 flex items-center justify-between rounded-xl border border-[#9E4B02]/70 bg-[#2A160C] px-4 py-3">
        <div>
          <div className="text-sm font-extrabold text-[#F9F2DD]">{t.sound.musica}</div>
          <div className="text-xs text-[#E0A04A]">{t.sound.trilhaSonoraDeFundo}</div>
        </div>
        <Toggle value={prefs.music} onChange={v => update({ music: v })} />
      </div>

      {/* Music track picker (visible when music is on) */}
      {prefs.music && (
        <div className="mb-3">
          <CategoryPicker<MusicTrackInfo>
            label={t.sound.faixaDeMusica}
            modalTitle={t.sound.faixaDeMusica}
            items={musicPickerItems}
            activeId={activeMusicTrack}
            onSelect={id => update({ musicTrack: id })}
            collapsedPreview={active => (active?.id === 'dynamic' ? '🎲' : '🎵')}
            activeLabel={active => active?.name ?? '—'}
            renderRow={(track, active, onSelect) => (
              <button
                key={track.id}
                onClick={onSelect}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition active:scale-[0.98] ${
                  active
                    ? 'bg-[#3C9A32] text-[#F9F2DD] shadow-[inset_0_-3px_0_#14520E]'
                    : 'bg-[#4A2C18] text-[#F9F2DD]'
                }`}
              >
                <span className="text-lg leading-none">{track.id === 'dynamic' ? '🎲' : '🎵'}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-extrabold text-[#F9F2DD]">
                    {track.name}
                  </div>
                  <div className="truncate text-[11px] text-[#F9F2DD]/70">
                    {track.id === 'dynamic' ? track.artist : `${track.artist} · ${track.style}`}
                  </div>
                </div>
                {active && <span className="shrink-0 text-xs font-extrabold text-[#FFE14A]">✓</span>}
              </button>
            )}
          />
        </div>
      )}

      {/* SFX toggle */}
      <div className="mb-3 flex items-center justify-between rounded-xl border border-[#9E4B02]/70 bg-[#2A160C] px-4 py-3">
        <div>
          <div className="text-sm font-extrabold text-[#F9F2DD]">{t.sound.efeitos}</div>
          <div className="text-xs text-[#E0A04A]">{t.sound.sonsDeDespejoEInterface}</div>
        </div>
        <Toggle value={prefs.sfx} onChange={v => update({ sfx: v })} />
      </div>

      {/* SFX picker (visible only when sfx is on) */}
      {prefs.sfx && (
        <CategoryPicker<SfxOption>
          label={t.sound.efeitoSonoroDaAgua}
          modalTitle={t.sound.efeitoSonoroDaAgua}
          items={SFX_OPTIONS}
          activeId={prefs.sfxStyle}
          onSelect={id => update({ sfxStyle: id })}
          collapsedPreview={() => '🧊'}
          activeLabel={active => (active ? t.sfx[active.id as keyof typeof t.sfx] : '—')}
          renderRow={(s, active, onSelect) => (
            <button
              key={s.id}
              onClick={onSelect}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition active:scale-[0.98] ${
                active
                  ? 'bg-[#3C9A32] text-[#F9F2DD] shadow-[inset_0_-3px_0_#14520E]'
                  : 'bg-[#4A2C18] text-[#F9F2DD]'
              }`}
            >
              <span className="text-base leading-none">🧊</span>
              <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-[#F9F2DD]">
                {t.sfx[s.id as keyof typeof t.sfx]}
              </span>
              {active && <span className="shrink-0 text-xs font-extrabold text-[#FFE14A]">✓</span>}
            </button>
          )}
        />
      )}
    </>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
        value ? 'bg-[#F5B20A]' : 'bg-[#5C3A24]'
      }`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-[#F9F2DD] shadow transition-all ${
          value ? 'left-6' : 'left-1'
        }`}
      />
    </button>
  );
}
