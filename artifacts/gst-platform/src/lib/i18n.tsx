import { Button } from "@/components/ui/button";
import { hi } from "./hi";

/**
 * Hindi on screen without touching every page: once Hindi is chosen, a
 * MutationObserver swaps each English text node (and placeholder, aria-label
 * and title) found in `hi` for its Hindi text, including text React renders
 * later. The printed invoice and anything marked translate="no" stay as they are.
 * ponytail: exact-match dictionary, so text built from parts ("3 invoices")
 * stays English; move to per-string t() calls if that matters.
 */
const KEY = "lang";
const ATTRS = ["placeholder", "aria-label", "title"];
const SKIP = "#invoice-print-area, [translate='no'], script, style, textarea";

export function currentLang(): "hi" | "en" {
  try { return localStorage.getItem(KEY) === "hi" ? "hi" : "en"; } catch { return "en"; }
}

function lookup(text: string): string | undefined {
  const key = text.replace(/\s+/g, " ").trim();
  const hit = key ? hi[key] : undefined;
  // Writing the same text back would fire the observer again, forever.
  return hit === key ? undefined : hit;
}

function translateText(node: Text) {
  const value = node.nodeValue ?? "";
  const hit = lookup(value);
  if (!hit || node.parentElement?.closest(SKIP)) return;
  // Keep the spaces around the words, which JSX uses to separate inline parts.
  node.nodeValue = value.match(/^\s*/)![0] + hit + value.match(/\s*$/)![0];
}

function translateAttrs(el: Element) {
  if (el.closest(SKIP)) return;
  for (const name of ATTRS) {
    const value = el.getAttribute(name);
    const hit = value && lookup(value);
    if (hit) el.setAttribute(name, hit);
  }
}

function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root as Text);
  if (!(root instanceof Element)) return;
  translateAttrs(root);
  root.querySelectorAll("[placeholder], [aria-label], [title]").forEach(translateAttrs);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) translateText(n as Text);
}

/** Called from main.tsx before the first render. */
export function startTranslation() {
  const lang = currentLang();
  document.documentElement.lang = lang;
  if (lang !== "hi") return;
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "childList") r.addedNodes.forEach(translateTree);
      else if (r.type === "characterData") translateText(r.target as Text);
      else translateAttrs(r.target as Element);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  translateTree(document.body);
}

/** Switches language. A reload puts every English string back cleanly. */
export function LanguageToggle({ className }: { className?: string }) {
  const toHindi = currentLang() !== "hi";
  const switchLang = () => {
    try { localStorage.setItem(KEY, toHindi ? "hi" : "en"); } catch {}
    location.reload();
  };
  return (
    <Button
      variant="ghost"
      translate="no"
      className={className}
      lang={toHindi ? "hi" : "en"}
      onClick={switchLang}
      aria-label={toHindi ? "हिंदी में देखें" : "View in English"}
    >
      {toHindi ? "हिंदी" : "English"}
    </Button>
  );
}
