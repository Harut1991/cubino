/**
 * General "Settings" modal: Language · Danger zone.
 * Opened from the "Settings" row of the menu.
 */
import { useState } from 'react';
import { resetAllData } from '../game/settings';
import { useT, useLanguage } from '../i18n/context';
import { LANG_NAMES, LANG_FLAGS, type Lang } from '../i18n/types';
import { AudioControls } from './AudioControls';
import { openPrivacyPolicy } from '../lib/privacyPolicy';

const LANG_ORDER: Lang[] = ['pt-BR', 'en', 'es'];

interface Props {
  onClose: () => void;
}

export function AjustesModal({ onClose }: Props) {
  const t = useT();
  const { lang, setLang } = useLanguage();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleConfirmReset = () => {
    setResetting(true);
    void resetAllData();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-5 backdrop-blur-sm"
      style={{ paddingBottom: 'var(--ad-banner-offset, 0px)' }}
      onClick={confirmingReset ? undefined : onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-xs overflow-y-auto overscroll-contain rounded-2xl border-2 border-[#E0A04A] bg-[#3A2012] px-3.5 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_16px_40px_rgba(59,10,0,0.55)]"
        onClick={e => e.stopPropagation()}
      >
        {confirmingReset ? (
          <>
            <div className="mb-5 flex items-center justify-between">
              <div className="text-lg font-extrabold tracking-wide text-[#FFE14A] [text-shadow:0_2px_0_#3B0A00]">{t.ajustes.apagarConfirmTitle}</div>
            </div>
            <div className="rounded-xl border border-[#E02323]/70 bg-[#4A1010] px-4 py-3 text-sm text-[#F9F2DD]">
              {t.ajustes.apagarConfirmBody}
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={handleConfirmReset}
                disabled={resetting}
                className="w-full rounded-xl bg-[#E02323] py-3 text-base font-extrabold text-[#F9F2DD] [text-shadow:0_2px_0_#5A0000] transition active:scale-95 disabled:opacity-60"
              >
                {resetting ? t.ajustes.apagando : t.ajustes.simApagarTudo}
              </button>
              <button
                onClick={() => setConfirmingReset(false)}
                disabled={resetting}
                className="w-full rounded-xl border border-[#E0A04A]/70 bg-[#2A160C] py-3 text-base font-extrabold text-[#F9F2DD] transition active:scale-95 disabled:opacity-60"
              >
                {t.common.cancelar}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-5 flex items-center justify-between">
              <div className="text-lg font-extrabold tracking-wide text-[#FFE14A] [text-shadow:0_2px_0_#3B0A00]">{t.ajustes.title}</div>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#E0A04A]/80 bg-[#2A160C] text-sm font-extrabold text-[#F9F2DD] transition active:scale-90"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl border border-[#9E4B02]/80 bg-[#2A160C] px-4 py-3">
              <div className="mb-2 text-sm font-extrabold tracking-wide text-[#FFE14A] [text-shadow:0_1px_0_#3B0A00]">{t.ajustes.idioma}</div>
              <div className="grid grid-cols-3 gap-2">
                {LANG_ORDER.map((code) => (
                  <button
                    key={code}
                    onClick={() => setLang(code)}
                    className={`flex flex-col items-center gap-0.5 rounded-xl py-2.5 text-xs transition active:scale-95 ${
                      lang === code
                        ? 'bg-[#3C9A32] text-[#F9F2DD] shadow-[inset_0_-3px_0_#14520E] [text-shadow:0_1px_0_#003500]'
                        : 'bg-[#4A2C18] text-[#F9F2DD]/80'
                    }`}
                  >
                    <span className="text-base leading-none">{LANG_FLAGS[code]}</span>
                    <span className="font-extrabold">{LANG_NAMES[code]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 text-sm font-extrabold tracking-wide text-[#FFE14A] [text-shadow:0_1px_0_#3B0A00]">{t.sound.title}</div>
              <AudioControls />
            </div>

            <button
              type="button"
              onClick={openPrivacyPolicy}
              className="mt-3 w-full rounded-xl border border-[#E0A04A]/70 bg-[#2A160C] py-2.5 text-sm font-extrabold text-[#F9F2DD] transition active:scale-95"
            >
              {t.ajustes.privacyPolicy}
            </button>

            <div className="mt-3 rounded-xl border border-[#E02323]/70 bg-[#2A160C] px-4 py-3">
              <div className="mb-2 text-sm font-extrabold tracking-wide text-[#FF5A5A] [text-shadow:0_1px_0_#5A0000]">{t.ajustes.zonaDePerigo}</div>
              <button
                onClick={() => setConfirmingReset(true)}
                className="w-full rounded-xl bg-[#E02323] py-2.5 text-sm font-extrabold text-[#F9F2DD] [text-shadow:0_2px_0_#5A0000] transition active:scale-95"
              >
                {t.ajustes.apagarTodosOsDados}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
