import TextRecognition from "@react-native-ml-kit/text-recognition";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as XLSX from "xlsx";
import { apiUpload } from "./api";
import { rowsFromBoxes } from "./ocr-rows";

/** Same ceiling as the website's importer. */
const MAX_BYTES = 10 * 1024 * 1024;
type Picked = { uri: string; name: string; mimeType?: string | null; size?: number | null };

/** Take a photo of a bill or statement. Null when the user backs out. */
export async function takePhoto(): Promise<Picked | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error("Allow camera access in Android settings to photograph a bill.");
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 });
  const a = r.canceled ? null : r.assets[0];
  return a ? { uri: a.uri, name: a.fileName ?? "photo.jpg", mimeType: a.mimeType ?? "image/jpeg", size: a.fileSize } : null;
}

/** Choose a PDF. Null when the user backs out. */
export const choosePdf = () => chooseFile(["application/pdf"]);

/** Choose an image, PDF, Excel or CSV file. Null when the user backs out. */
export async function chooseFile(only?: string[]): Promise<Picked | null> {
  const r = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    type: only ?? ["image/*", "text/csv", "text/comma-separated-values", "text/plain", "application/pdf", "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  });
  return r.canceled ? null : r.assets[0];
}

/** The text of a picked file: OCR for images, the server for PDFs, cells for spreadsheets, as-is for CSV and text. */
export async function fileText(file: Picked): Promise<string> {
  if (file.size && file.size > MAX_BYTES) throw new Error("That file is over 10 MB. Use a smaller one.");
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const mime = file.mimeType ?? "";
  if (mime === "application/pdf" || ext === "pdf") {
    // The phone has no PDF reader: the server returns the text (it stores nothing), and a scan comes back as an error asking for a photo.
    return (await apiUpload<{ text: string }>("/import/pdf-text", file.uri, "application/pdf")).text;
  }
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "heic"].includes(ext)) {
    const result = await TextRecognition.recognize(file.uri);
    const boxes = result.blocks.flatMap((b) => b.lines).flatMap((l) => (l.frame ? [{ text: l.text, top: l.frame.top, left: l.frame.left, height: l.frame.height }] : []));
    return boxes.length ? rowsFromBoxes(boxes) : result.text;
  }
  if (["xls", "xlsx", "xlsm"].includes(ext) || mime.includes("spreadsheet") || mime === "application/vnd.ms-excel") {
    const book = XLSX.read(await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 }), { type: "base64" });
    return book.SheetNames.map((n) => XLSX.utils.sheet_to_csv(book.Sheets[n], { FS: "\t", blankrows: false })).filter(Boolean).join("\n");
  }
  return FileSystem.readAsStringAsync(file.uri);
}
