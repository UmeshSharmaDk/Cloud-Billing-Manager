import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const KEY = "theme";

/** Saved choice, else the device setting. Called from main.tsx before the first render. */
export function applySavedTheme() {
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  const dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem(KEY, next ? "dark" : "light"); } catch {}
    setDark(next);
  };
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={label} title={label}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
