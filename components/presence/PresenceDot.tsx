export function PresenceDot({ colors, extra }: { colors: string[]; extra: number }) {
  if (colors.length === 0) {
    return null;
  }

  return (
    <span className="pointer-events-none absolute bottom-0.5 start-1 flex items-center gap-0.5">
      {colors.map((color, index) => (
        <span key={`${color}-${index}`} className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      ))}
      {extra > 0 ? <span className="text-[9px] leading-none text-muted">+{extra}</span> : null}
    </span>
  );
}
