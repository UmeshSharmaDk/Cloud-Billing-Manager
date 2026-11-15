/** Indian numbers are stored as typed; WhatsApp wants country code and digits only. */
export function waNumber(phone?: string | null): string | null {
  const d = (phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/**
 * A WhatsApp click-to-chat link with a payment reminder already typed in. It
 * opens WhatsApp on the user's own phone or computer; nothing is sent until
 * they press send, and no WhatsApp Business API account is needed.
 */
export function reminderLink(inv: any, customerPhone: string | null | undefined, business: { name?: string; upiId?: string | null }, money: (n: number) => string, date: (d: string) => string): string | null {
  const due = Number(inv.grandTotal) - Number(inv.paidAmount ?? 0);
  if (inv.status === "cancelled" || !(due > 0)) return null;
  const lines = [
    `Hello ${inv.customerName},`,
    `This is a reminder from ${business.name ?? "us"} that invoice ${inv.invoiceNumber} dated ${date(inv.invoiceDate)} has ${money(due)} due${inv.dueDate ? ` (due ${date(inv.dueDate)})` : ""}.`,
    business.upiId ? `You can pay by UPI to ${business.upiId}.` : "",
    "Thank you!",
  ].filter(Boolean);
  const to = waNumber(customerPhone);
  return `https://wa.me/${to ?? ""}?text=${encodeURIComponent(lines.join("\n"))}`;
}
