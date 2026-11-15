export type Box = { text: string; top: number; left: number; height: number };

/**
 * OCR returns blocks column by column; a bill or statement is read row by row.
 * Put every recognised line back on its row (by vertical position) and order
 * each row left to right, so "item qty rate amount" comes out on one line.
 */
export function rowsFromBoxes(boxes: Box[]): string {
  const sorted = [...boxes].sort((a, b) => a.top - b.top);
  const rows: Box[][] = [];
  for (const b of sorted) {
    const row = rows[rows.length - 1];
    const mid = b.top + b.height / 2;
    if (row && mid < row[0].top + row[0].height) row.push(b);
    else rows.push([b]);
  }
  return rows.map((r) => r.sort((a, b) => a.left - b.left).map((b) => b.text).join(" ")).join("\n");
}
