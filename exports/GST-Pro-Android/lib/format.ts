const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });

export const money = (n: number | null | undefined) => inr.format(Number(n ?? 0));

export const date = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const statusColor: Record<string, string> = {
  paid: "#16a34a",
  partial: "#d97706",
  unpaid: "#dc2626",
  cancelled: "#6b7280",
};
