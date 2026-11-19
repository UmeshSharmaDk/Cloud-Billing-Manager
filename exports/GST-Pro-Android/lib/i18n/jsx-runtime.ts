/**
 * The app's JSX runtime (babel.config.js points app code here): React's own,
 * with English text swapped for Hindi when Hindi is chosen. See ./index.ts.
 */
import * as React from "react/jsx-runtime";
import { Text } from "react-native";
import { isHindi, t } from "./index";

/** Props that our components show as text. */
const PROPS = ["title", "label", "placeholder", "accessibilityLabel", "accessibilityHint", "message", "note", "disabledReason", "action", "headerTitle", "tabBarLabel"];

const swapChild = (c: unknown) => (typeof c === "string" ? t(c) : c);

export function translateProps(type: unknown, props: any) {
  if (!isHindi || !props || typeof props !== "object") return props;
  let out = props;
  const set = (k: string, v: unknown) => { if (out === props) out = { ...props }; out[k] = v; };
  for (const k of PROPS) {
    const v = props[k];
    if (typeof v === "string") { const h = t(v); if (h !== v) set(k, h); }
  }
  // Screen titles: <Stack.Screen options={{ title }} /> and the tab bar.
  const o = props.options;
  if (o && typeof o === "object" && typeof o.title === "string") { const h = t(o.title); if (h !== o.title) set("options", { ...o, title: h }); }
  if (type === Text && props.children !== undefined) {
    const c = props.children;
    if (typeof c === "string") set("children", t(c));
    else if (Array.isArray(c) && c.some((x) => typeof x === "string")) set("children", c.map(swapChild));
  }
  return out;
}

export const Fragment = React.Fragment;
export function jsx(type: any, props: any, key?: any) { return React.jsx(type, translateProps(type, props), key); }
export function jsxs(type: any, props: any, key?: any) { return React.jsxs(type, translateProps(type, props), key); }
