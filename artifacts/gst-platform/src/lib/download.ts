import { authFetch } from "@/lib/api-fetch";

/** Save a Blob as a file. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download a file the API serves (GSTR-1 JSON, Tally XML), keeping the server's filename. */
export async function downloadFromApi(path: string, fallbackName: string) {
  const res = await authFetch(path);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Could not download the file.");
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  saveBlob(await res.blob(), name);
}

export type Sheet = { name: string; rows: Record<string, unknown>[] };

/** Write an Excel workbook. SheetJS is loaded only when someone exports. */
export async function downloadXlsx(filename: string, sheets: Sheet[]) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ Note: "No rows for this period" }]);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

/** Every row of a paged list endpoint, 100 at a time. */
export async function fetchAllPages<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 200; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await authFetch(`/api${path}${sep}page=${page}&limit=100`);
    if (!res.ok) throw new Error("Could not load the list to export.");
    const data = await res.json();
    const rows: T[] = data[key] ?? [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}
