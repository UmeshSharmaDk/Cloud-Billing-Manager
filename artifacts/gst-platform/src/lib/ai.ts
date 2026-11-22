import { authFetch } from "@/lib/api-fetch";
import { currentLang } from "@/lib/i18n";

/** AI help. Everything it returns is a draft or an answer; nothing is saved by it. */
async function read<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || "The AI could not answer just now. Try again.");
  return data as T;
}

export const ai = async <T,>(path: string, body: Record<string, unknown>): Promise<T> =>
  read<T>(await authFetch(`/api/ai/${path}`, { method: "POST", body: JSON.stringify({ lang: currentLang(), ...body }) }));

export interface BillDraft {
  vendorName: string; vendorGstin: string; billNumber: string; billDate: string; warnings: string[];
  items: Array<{ description: string; hsnCode: string; quantity: number; unit: string; unitPrice: number; gstRate: number }>;
}

/** Photos and PDFs the AI can read. HEIC often comes with no type, so it goes by extension. */
export function billType(file: File): string | null {
  if (/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.type === "application/pdf") return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "heic" || ext === "heif" ? `image/${ext}` : null;
}

export const readBill = async (file: File, type: string): Promise<BillDraft> =>
  read<BillDraft>(await authFetch(`/api/ai/bill?lang=${currentLang()}`, { method: "POST", body: file, headers: { "Content-Type": type } }));

export interface InvoiceDraft {
  customerId: number | null; customerName: string; stateCode: string; dueInDays: number | null; notes: string; questions: string[];
  items: Array<{ productId: number | null; description: string; hsnCode: string; quantity: number; unit: string; unitPrice: number; gstRate: number; discount: number }>;
}
