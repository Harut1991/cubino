/** Gold crown used everywhere a coin is shown. */
export function CoinIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <img
      src="/ui/coin.png"
      alt=""
      draggable={false}
      className={`inline-block shrink-0 object-contain ${className}`}
    />
  );
}
