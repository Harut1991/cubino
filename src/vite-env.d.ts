/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ADMOB_ANDROID_APP_ID?: string;
  readonly VITE_ADMOB_ANDROID_REWARDED_ID?: string;
  readonly VITE_ADMOB_ANDROID_INTERSTITIAL_ID?: string;
  readonly VITE_ADMOB_IOS_APP_ID?: string;
  readonly VITE_ADMOB_IOS_BANNER_ID?: string;
  readonly VITE_ADMOB_IOS_INTERSTITIAL_ID?: string;
}

/** Build timestamp, injected by vite.config.ts's `define` — see src/lib/appVersion.ts. */
declare const __APP_VERSION__: string;
