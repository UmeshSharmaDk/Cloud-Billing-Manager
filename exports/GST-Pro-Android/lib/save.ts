import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "react-native";

/**
 * Runs a write, refreshes every cached query, and shows the server's error if
 * it fails. ponytail: refetches everything after a write; scope the
 * invalidation if that ever gets slow.
 */
export function useSave() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function run<T>(fn: () => Promise<T>, done?: (r: T) => void, onError?: (e: unknown) => boolean) {
    setBusy(true);
    try {
      const r = await fn();
      await qc.invalidateQueries();
      done?.(r);
    } catch (e) {
      if (!onError?.(e)) Alert.alert("Something went wrong", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

export const today = () => new Date().toISOString().slice(0, 10);
export const num = (v: string) => (v.trim() === "" ? null : Number(v));
