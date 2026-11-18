import { Switch } from "@/components/ui/switch";

/** A switch whose whole row is the tap target (at least 44px tall). */
export function ToggleRow({ id, label, note, checked, onChange, busy }: {
  id: string; label: string; note?: string; checked: boolean; onChange: (next: boolean) => void; busy?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </span>
      <Switch id={id} checked={checked} onCheckedChange={(v) => { if (!busy) onChange(v); }} aria-busy={busy} />
    </label>
  );
}
