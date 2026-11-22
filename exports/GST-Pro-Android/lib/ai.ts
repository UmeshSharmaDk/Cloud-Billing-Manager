import { api, apiUpload } from "./api";
import { isHindi } from "./i18n";

/** AI help from the server. It only reads and drafts; nothing is saved by it. */
const lang = isHindi ? "hi" : "en";
export const ai = <T,>(path: string, body: Record<string, unknown>) => api<T>(`/ai/${path}`, { method: "POST", body: { lang, ...body } });

export type BillDraft = {
  vendorName: string; vendorGstin: string; billNumber: string; billDate: string; warnings: string[];
  items: Array<{ description: string; hsnCode: string; quantity: number; unit: string; unitPrice: number; gstRate: number }>;
};

type Picked = { uri: string; name: string; mimeType?: string | null; size?: number | null };

/** Sends a photo or PDF of a purchase bill to the AI to read. */
export function readBill(file: Picked): Promise<BillDraft> {
  if (file.size && file.size > 10 * 1024 * 1024) throw new Error("That file is over 10 MB. Use a smaller one.");
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const type = file.mimeType && /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(file.mimeType) ? file.mimeType
    : ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "heic" ? "image/heic" : "image/jpeg";
  return apiUpload<BillDraft>(`/ai/bill?lang=${lang}`, file.uri, type);
}

export type InvoiceDraft = {
  customerId: number | null; customerName: string; stateCode: string; dueInDays: number | null; notes: string; questions: string[];
  items: Array<{ productId: number | null; description: string; hsnCode: string; quantity: number; unit: string; unitPrice: number; gstRate: number; discount: number }>;
};
