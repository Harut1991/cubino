import { useState } from 'react';
import { BG_THEMES, type Wallet, type ShopItem, type BgTheme } from '../game/economy';
import { CategoryPicker } from './CategoryPicker';
import { useT } from '../i18n/context';
import { CoinIcon } from './CoinIcon';
import type { Dictionary } from '../i18n/types';

const bgName = (t: Dictionary, id: string) => t.economy.bg[id as keyof typeof t.economy.bg];

interface Props {
  wallet: Wallet;
  onBuyOrEquip: (item: ShopItem) => void;
  onPreview: (item: ShopItem) => void;
  onWatchAd: () => Promise<boolean>;
  onClose: () => void;
}

export function ShopModal({ wallet, onBuyOrEquip, onPreview, onWatchAd, onClose }: Props) {
  const t = useT();
  const owned = (id: string) => wallet.owned.includes(id);
  // Item currently being previewed (not purchased yet)
  const [previewing, setPreviewing] = useState<ShopItem | null>(null);
  const [watching, setWatching] = useState(false);

  const handleItemClick = (item: ShopItem) => {
    if (owned(item.id) || item.price === 0) {
      // Already owned or free → equip directly, no confirmation
      onBuyOrEquip(item);
      setPreviewing(null);
    } else if (previewing?.id === item.id) {
      // Clicked the same item already in preview → no-op (use the Buy button)
    } else {
      // Paid item not owned → enter preview
      setPreviewing(item);
      onPreview(item);
    }
  };

  const handleBuy = () => {
    if (!previewing) return;
    onBuyOrEquip(previewing);
    setPreviewing(null);
  };

  const canAffordPreview = previewing ? wallet.coins >= previewing.price : false;

  // "Active" ID shown in each category picker: if there's an item from that
  // category in preview, show it; otherwise show the equipped one.
  const activeBgId = previewing?.kind === 'bg' ? previewing.id : wallet.bg;

  // Buy footer INSIDE each category's child modal — shows "Buy" while the paid item is in
  // preview, so the action is reachable without having to close the modal to find it.
  const buyFooter = (kind: ShopItem['kind']) => {
    if (!previewing || previewing.kind !== kind) return null;
    return (
      <button
        onClick={handleBuy}
        disabled={!canAffordPreview}
        className="w-full rounded-xl bg-teal-400 py-3 text-base font-semibold text-slate-900 transition active:scale-95 disabled:opacity-40"
      >
        <span className="inline-flex items-center justify-center gap-1.5">
          <CoinIcon className="h-4 w-4" />
          {canAffordPreview ? t.shop.comprarPor(previewing.price) : t.shop.saldoInsuficiente(previewing.price)}
        </span>
      </button>
    );
  };

  const watch = () => {
    if (watching) return;
    setWatching(true);
    void onWatchAd().finally(() => setWatching(false));
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style={{ paddingBottom: 'var(--ad-banner-offset, 0px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal card — flex column with a max height so scrolling works */}
      <div className="flex max-h-[85dvh] w-full max-w-sm flex-col rounded-2xl bg-slate-900 shadow-2xl">

        {/* ── Fixed header ── */}
        <div className="shrink-0 px-5 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold text-slate-100">{t.shop.title}</span>
            <div className="flex items-center gap-1.5 text-base font-medium text-amber-400">
              <CoinIcon className="h-5 w-5" />
              <span>{t.common.moedas(wallet.coins)}</span>
            </div>
          </div>
        </div>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-2">
          <div className="mb-3">
            <CategoryPicker<BgTheme>
              label={t.shop.fundos}
              modalTitle={t.shop.fundos}
              items={BG_THEMES}
              activeId={activeBgId}
              onSelect={id => {
                const item = BG_THEMES.find(b => b.id === id);
                if (item) handleItemClick(item);
              }}
              collapsedPreview={active => active && <BgSwatch top={active.top} mid={active.mid} deep={active.deep} image={active.image} size="sm" />}
              activeLabel={active => (active ? bgName(t, active.id) : '—')}
              bigPreview={active => active && <BgSwatch top={active.top} mid={active.mid} deep={active.deep} image={active.image} size="lg" />}
              renderRow={(bg) => {
                const isOwned = owned(bg.id);
                const isEquipped = wallet.bg === bg.id;
                const isPreviewing = previewing?.id === bg.id;
                return (
                  <ItemRow
                    key={bg.id}
                    name={bgName(t, bg.id)}
                    price={bg.price}
                    isOwned={isOwned}
                    isEquipped={isEquipped}
                    isPreviewing={isPreviewing}
                    canAfford={wallet.coins >= bg.price || isOwned}
                    preview={<BgSwatch top={bg.top} mid={bg.mid} deep={bg.deep} image={bg.image} size="sm" />}
                    onClick={() => handleItemClick(bg)}
                  />
                );
              }}
              footer={buyFooter('bg')}
            />
          </div>

          <button
            type="button"
            onClick={watch}
            disabled={watching}
            className="mb-3 flex w-full items-center gap-3 rounded-xl bg-slate-800 px-3 py-3 text-left transition active:scale-95 disabled:opacity-60"
          >
            <img src="/ui/ad.png" alt="" draggable={false} className="h-12 w-12 shrink-0 object-contain" />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-medium text-slate-100">{t.shop.verAnuncio}</span>
              <span className="mt-0.5 flex items-center gap-1 text-sm font-semibold text-amber-300">
                {t.shop.moedasAnuncio(10)}
                <CoinIcon className="h-4 w-4" />
              </span>
            </span>
          </button>
        </div>

        {/* ── Fixed footer ── */}
        <div className="shrink-0 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 flex flex-col gap-2">
          {previewing && (
            <button
              onClick={handleBuy}
              disabled={!canAffordPreview}
              className="w-full rounded-xl bg-teal-400 py-3 text-base font-semibold text-slate-900 transition active:scale-95 disabled:opacity-40"
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <CoinIcon className="h-4 w-4" />
                {canAffordPreview
                  ? t.shop.comprarPor(previewing.price)
                  : t.shop.saldoInsuficiente(previewing.price)}
              </span>
            </button>
          )}
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-slate-800 py-3 text-base font-medium text-slate-300 transition active:scale-95"
          >
            {previewing ? t.common.cancelar : t.common.fechar}
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemRow({
  name, price, isOwned, isEquipped, isPreviewing, canAfford, preview, onClick,
}: {
  name: string; price: number; isOwned: boolean; isEquipped: boolean;
  isPreviewing: boolean; canAfford: boolean; preview: React.ReactNode; onClick: () => void;
}) {
  const t = useT();
  const showCoin = !isEquipped && !isPreviewing && !isOwned && price > 0;
  const label = isEquipped
    ? t.shop.emUso
    : isPreviewing
      ? t.shop.visualizando
      : isOwned
        ? t.shop.equipar
        : price === 0
          ? t.shop.gratis
          : t.common.moedas(price);

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition active:scale-95 ${
        isEquipped
          ? 'bg-teal-400/15 ring-1 ring-teal-400/50'
          : isPreviewing
            ? 'bg-sky-400/10 ring-1 ring-sky-400/40'
            : 'bg-slate-700/60 hover:bg-slate-700'
      } ${!isOwned && !canAfford && !isPreviewing ? 'opacity-50' : ''}`}
    >
      <div className="shrink-0">{preview}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-medium text-slate-100">{name}</div>
        <div className={`flex items-center gap-1 text-sm ${isPreviewing ? 'text-sky-400' : 'text-slate-400'}`}>
          {showCoin && <CoinIcon className="h-3.5 w-3.5" />}
          <span>{label}</span>
        </div>
      </div>
      {isEquipped && <span className="shrink-0 text-sm font-semibold text-teal-400">✓</span>}
      {isPreviewing && <span className="shrink-0 text-sm text-sky-400">◉</span>}
    </button>
  );
}

function bgPaint(theme: { top: number; mid: number; deep: number; image?: string }): string {
  if (theme.image) return `center / cover no-repeat url('${theme.image}')`;
  const toHex = (n: number) => '#' + n.toString(16).padStart(6, '0');
  return `linear-gradient(to bottom, ${toHex(theme.top)}, ${toHex(theme.mid)}, ${toHex(theme.deep)})`;
}

function BgSwatch({ top, mid, deep, image, size = 'sm' }: { top: number; mid: number; deep: number; image?: string; size?: 'sm' | 'lg' }) {
  const background = bgPaint({ top, mid, deep, image });
  if (size === 'lg') {
    return (
      <div
        className="h-28 w-full rounded-xl ring-1 ring-white/10"
        style={{ background }}
      />
    );
  }
  return (
    <div
      className="h-10 w-10 rounded-lg"
      style={{ background }}
    />
  );
}
