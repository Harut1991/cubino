/**
 * Rewarded video ads for an extra tube, an undo, and coins.
 * Android reads the AdMob ids from .env: the rewarded unit for an extra tube, an undo,
 * and coins, and the interstitial unit between every third level.
 * iOS shows the AdMob banner and the interstitial between every third level.
 * A release build in the browser uses AdSense for Games.
 * Web, Android, and iOS development builds skip the ad and still grant the reward.
 */

import { Capacitor } from '@capacitor/core';

const PUBLISHER = 'ca-pub-1811884588047510';
const ANDROID_REWARDED_ID = import.meta.env.VITE_ADMOB_ANDROID_REWARDED_ID ?? '';
const ANDROID_INTERSTITIAL_ID = import.meta.env.VITE_ADMOB_ANDROID_INTERSTITIAL_ID ?? '';
const IOS_BANNER_ID = import.meta.env.VITE_ADMOB_IOS_BANNER_ID ?? '';
const IOS_INTERSTITIAL_ID = import.meta.env.VITE_ADMOB_IOS_INTERSTITIAL_ID ?? '';

/** Release builds show ads. The web dev server, an Android debug app, and an iOS debug app do not. */
function liveAds(): boolean {
  if (import.meta.env.DEV || Capacitor.DEBUG) return false;
  return true;
}

function isAndroidApp(): boolean {
  return Capacitor.getPlatform() === 'android';
}

function isIosApp(): boolean {
  return Capacitor.getPlatform() === 'ios';
}

function safeAreaBottom(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;bottom:0;height:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none;';
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Math.round(height);
}

function setBannerOffset(height: number): void {
  document.documentElement.style.setProperty('--ad-banner-offset', `${Math.max(0, Math.round(height))}px`);
  window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

let iosReady: Promise<boolean> | null = null;
let iosBannerStarted = false;

function ensureIosAds(): Promise<boolean> {
  if (!liveAds() || (!IOS_BANNER_ID && !IOS_INTERSTITIAL_ID)) return Promise.resolve(false);
  if (iosReady) return iosReady;
  iosReady = (async () => {
    try {
      const { AdMob, AdmobConsentStatus } = await import('@capacitor-community/admob');
      await AdMob.initialize();
      const tracking = await AdMob.trackingAuthorizationStatus();
      if (tracking.status === 'notDetermined') {
        await AdMob.requestTrackingAuthorization();
      }
      let consent = await AdMob.requestConsentInfo();
      if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
        consent = await AdMob.showConsentForm();
      }
      return consent.canRequestAds;
    } catch {
      iosReady = null;
      return false;
    }
  })();
  return iosReady;
}

async function showIosBanner(): Promise<void> {
  if (!liveAds() || iosBannerStarted || !IOS_BANNER_ID) return;
  iosBannerStarted = true;
  if (!(await ensureIosAds())) {
    iosBannerStarted = false;
    return;
  }
  try {
    const { AdMob, BannerAdPluginEvents, BannerAdPosition, BannerAdSize } = await import('@capacitor-community/admob');
    await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (info) => {
      setBannerOffset(info.height);
    });
    await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, () => {
      setBannerOffset(0);
    });
    setBannerOffset(50);
    await AdMob.showBanner({
      adId: IOS_BANNER_ID,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: safeAreaBottom(),
      isTesting: false,
    });
  } catch {
    iosBannerStarted = false;
    setBannerOffset(0);
  }
}

async function showNativeInterstitial(adId: string): Promise<void> {
  try {
    const { AdMob, InterstitialAdPluginEvents } = await import('@capacitor-community/admob');
    await AdMob.prepareInterstitial({ adId, isTesting: false });
    await new Promise<void>((resolve) => {
      let settled = false;
      const handles: Array<{ remove: () => Promise<void> }> = [];
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        for (const handle of handles) void handle.remove();
        resolve();
      };
      const timer = window.setTimeout(finish, 120000);
      void Promise.all([
        AdMob.addListener(InterstitialAdPluginEvents.Dismissed, finish),
        AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, finish),
      ]).then((registered) => {
        handles.push(...registered);
        if (settled) {
          for (const handle of registered) void handle.remove();
          return;
        }
        void AdMob.showInterstitial().catch(finish);
      }).catch(finish);
    });
  } catch {
    // No ad is available. The next level still starts.
  }
}

let androidReady: Promise<boolean> | null = null;

function ensureAndroidAds(): Promise<boolean> {
  if (!liveAds() || (!ANDROID_REWARDED_ID && !ANDROID_INTERSTITIAL_ID)) return Promise.resolve(false);
  if (androidReady) return androidReady;
  androidReady = (async () => {
    try {
      const { AdMob, AdmobConsentStatus } = await import('@capacitor-community/admob');
      await AdMob.initialize();
      let consent = await AdMob.requestConsentInfo();
      if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
        consent = await AdMob.showConsentForm();
      }
      return consent.canRequestAds;
    } catch {
      androidReady = null;
      return false;
    }
  })();
  return androidReady;
}

async function showAndroidInterstitial(): Promise<void> {
  if (!ANDROID_INTERSTITIAL_ID || !(await ensureAndroidAds())) return;
  await showNativeInterstitial(ANDROID_INTERSTITIAL_ID);
}

async function showIosInterstitial(): Promise<void> {
  if (!IOS_INTERSTITIAL_ID || !(await ensureIosAds())) return;
  await showNativeInterstitial(IOS_INTERSTITIAL_ID);
}

async function showAndroidRewardedAd(): Promise<boolean> {
  if (!liveAds() || !ANDROID_REWARDED_ID || !(await ensureAndroidAds())) return false;
  try {
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.prepareRewardVideoAd({ adId: ANDROID_REWARDED_ID, isTesting: false });
    await AdMob.showRewardVideoAd();
    return true;
  } catch {
    return false;
  }
}

type AdBreakDone = { breakStatus?: string };

declare global {
  interface Window {
    adsbygoogle?: object[];
    adBreak?: (options: Record<string, unknown>) => void;
    adConfig?: (options: Record<string, unknown>) => void;
  }
}

let loading: Promise<void> | null = null;
let scriptFailed = false;

export function loadRewardedAds(): Promise<void> {
  if (!liveAds()) return Promise.resolve();
  if (isAndroidApp()) return ensureAndroidAds().then(() => undefined);
  if (isIosApp()) {
    void showIosBanner();
    return Promise.resolve();
  }
  if (loading) return loading;
  loading = new Promise((resolve) => {
    window.adsbygoogle = window.adsbygoogle || [];
    const stub = (options: Record<string, unknown>) => { window.adsbygoogle!.push(options); };
    window.adBreak = window.adBreak || stub;
    window.adConfig = window.adConfig || stub;
    window.adConfig({ preloadAdBreaks: 'on', sound: 'on' });

    if (document.querySelector('script[data-ads-reward]')) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.adsReward = '1';
    script.dataset.adClient = PUBLISHER;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${PUBLISHER}`;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptFailed = true;
      resolve();
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Resolves true when the player finished the video, or immediately in a development build. */
export function showRewardedAd(): Promise<boolean> {
  if (!liveAds()) return Promise.resolve(true);
  if (isAndroidApp()) return showAndroidRewardedAd();
  if (isIosApp()) return Promise.resolve(false);
  return loadRewardedAds().then(() => new Promise((resolve) => {
    let settled = false;
    let viewed = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), 120000);
    if (scriptFailed || typeof window.adBreak !== 'function') {
      finish(false);
      return;
    }
    window.adBreak({
      type: 'reward',
      name: 'extra-tube',
      beforeReward: (showAdFn: () => void) => {
        showAdFn();
      },
      adViewed: () => {
        viewed = true;
      },
      adBreakDone: (_info: AdBreakDone) => {
        finish(viewed);
      },
    });
  }));
}

/** Short ad between levels. Continues when the ad closes or if none is available. */
export function showShortAd(): Promise<void> {
  if (!liveAds()) return Promise.resolve();
  if (isAndroidApp()) return showAndroidInterstitial();
  if (isIosApp()) return showIosInterstitial();
  return loadRewardedAds().then(() => new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, 30000);
    if (scriptFailed || typeof window.adBreak !== 'function') {
      finish();
      return;
    }
    window.adBreak({
      type: 'next',
      name: 'every-3-levels',
      adBreakDone: () => finish(),
    });
  }));
}
