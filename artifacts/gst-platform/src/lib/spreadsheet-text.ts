import * as XLSX from "xlsx";

/**
 * Flattens every sheet of a spreadsheet (.xlsx/.xlsm/.xls/.csv) into tab-separated text,
 * one block per sheet, which is the shape the bill parser's line-item extractors expect.
 *
 * Kept in its own module (importing nothing but SheetJS) so it can be exercised outside the
 * browser bundle.
 */
export function spreadsheetBufferToText(buffer: ArrayBuffer): string {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  return workbook.SheetNames
    .map(name => {
      const sheet = workbook.Sheets[name];
      return XLSX.utils.sheet_to_csv(sheet, { FS: "\t", blankrows: false });
    })
    .filter(Boolean)
    .join("\n");
}
