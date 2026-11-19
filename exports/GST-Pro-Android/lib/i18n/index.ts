import * as SecureStore from "expo-secure-store";
import * as Updates from "expo-updates";
import { Alert, DevSettings } from "react-native";
import { hi } from "./hi";

/**
 * Hindi for the app. Read once at start (like the theme), and switching
 * restarts the app. Every screen's text goes through the JSX runtime in
 * ./jsx-runtime, which looks <Text> strings and label-like props up in `hi`,
 * so screens are written in English as usual.
 * ponytail: exact-match dictionary, so text built from parts ("3 invoices")
 * stays English; move to per-string t() calls if that matters.
 */
const KEY = "lang";
export const isHindi = SecureStore.getItem(KEY) === "hi";

export function t(text: string): string {
  if (!isHindi) return text;
  return hi[text.replace(/\s+/g, " ").trim()] ?? text;
}

export function setHindi(on: boolean) {
  SecureStore.setItem(KEY, on ? "hi" : "en");
  Updates.reloadAsync().catch(() => DevSettings.reload());
}

// Alerts are not JSX, so their words are swapped here.
if (isHindi) {
  const alert = Alert.alert.bind(Alert);
  Alert.alert = (title, message, buttons, options) =>
    alert(t(title), message === undefined ? message : t(message), buttons?.map((b) => ({ ...b, text: b.text === undefined ? b.text : t(b.text) })), options);
}
