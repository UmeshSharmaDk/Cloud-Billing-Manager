const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });

export const money = (n: number | null | undefined) => inr.format(Number(n ?? 0));

export const date = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** Status to palette tone; ui.tsx turns it into the light or dark colour. */
export const statusColor: Record<string, "success" | "warning" | "danger" | "muted"> = {
  paid: "success",
  partial: "warning",
  unpaid: "danger",
  cancelled: "muted",
  declined: "muted",
  draft: "warning",
  pending: "warning",
  generated: "success",
  approved: "success",
  active: "success",
  inactive: "danger",
};
