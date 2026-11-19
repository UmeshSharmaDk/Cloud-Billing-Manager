/** Development builds use this entry; same swap as ./jsx-runtime. */
import * as React from "react/jsx-dev-runtime";
import { translateProps } from "./jsx-runtime";

export const Fragment = React.Fragment;
export function jsxDEV(type: any, props: any, key: any, isStatic: boolean, source: any, self: any) {
  return React.jsxDEV(type, translateProps(type, props), key, isStatic, source, self);
}
