/** "+12.5% vs Oct". Says what it compares with; null when there is nothing to compare. */
export function deltaText(current: number, previous: number, against: string) {
  if (!previous) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return `${pct >= 0 ? "+" : "\u2212"}${Math.abs(pct).toFixed(1)}% vs ${against}`;
}

/** A small label above a number, the way every figure on the dashboards is set. */
export function Figure({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-foreground mt-1 truncate">{value}</p>
      {note && <p className="text-xs text-muted-foreground mt-0.5">{note}</p>}
    </div>
  );
}
