import * as FileSystem from "expo-file-system/legacy";

/**
 * Working without a connection, with no new native module (so it ships OTA):
 *
 * - Every successful GET is saved on the phone; when the server cannot be
 *   reached, `api()` answers from that copy, so lists and invoices still open.
 * - A new invoice made offline waits in a queue and is sent when the phone is
 *   back online. Its `clientRef` makes a resend return the same invoice, so a
 *   lost reply cannot create it twice. The number is given by the server on send.
 *
 * Saved screens are wiped on sign-out, so the next person on the phone sees
 * none of them. Queued invoices are kept (a sign-out must not lose a sale) but
 * belong to the user who made them: only that user's session sends or lists them.
 * ponytail: one file per GET path, never pruned; prune by age if phones fill up.
 */
const dir = `${FileSystem.documentDirectory}offline/`;
const queueFile = `${dir}queue.json`;

// FNV-1a: a short, stable file name for an API path.
const key = (path: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 0x01000193);
  return `${dir}${(h >>> 0).toString(16)}.json`;
};

let ready: Promise<void> | null = null;
const ensureDir = () => (ready ??= FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {}));

/** True while the last request could not reach the server. */
let offline = false;
const listeners = new Set<() => void>();
export const isOffline = () => offline;
export function setOffline(next: boolean) {
  if (next === offline) return;
  offline = next;
  listeners.forEach((l) => l());
}
export function onChange(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export async function savedGet<T>(path: string): Promise<T | undefined> {
  try {
    const raw = await FileSystem.readAsStringAsync(key(path));
    return (JSON.parse(raw) as { path: string; data: T }).data;
  } catch {
    return undefined;
  }
}

export async function saveGet(path: string, data: unknown) {
  await ensureDir();
  await FileSystem.writeAsStringAsync(key(path), JSON.stringify({ path, data })).catch(() => {});
}

export type Queued = { ref: string; userId: number; path: string; body: Record<string, unknown>; label: string; savedAt: string; error?: string };

async function allQueued(): Promise<Queued[]> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(queueFile)) as Queued[];
  } catch {
    return [];
  }
}

/** This user's waiting items. */
export async function queued(userId: number): Promise<Queued[]> {
  return (await allQueued()).filter((x) => x.userId === userId);
}

async function writeQueue(q: Queued[]) {
  await ensureDir();
  await FileSystem.writeAsStringAsync(queueFile, JSON.stringify(q));
  listeners.forEach((l) => l());
}

/** A random id for `clientRef`. Not secret, only unique per business. */
export const newRef = () => `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export async function enqueue(item: Omit<Queued, "savedAt">) {
  await writeQueue([...(await allQueued()), { ...item, savedAt: new Date().toISOString() }]);
}

/**
 * Sends each waiting item in order. Stops at the first network failure (still
 * offline); an item the server refuses keeps its error for the user to see.
 */
export async function flush(userId: number, send: (q: Queued) => Promise<void>, isNetworkError: (e: unknown) => boolean) {
  const mine = (await allQueued()).filter((x) => x.userId === userId);
  if (!mine.length) return 0;
  const sent = new Set<string>();
  const errors = new Map<string, string>();
  for (const item of mine) {
    try {
      await send(item);
      sent.add(item.ref);
    } catch (e) {
      if (isNetworkError(e)) break;
      errors.set(item.ref, e instanceof Error ? e.message : String(e));
    }
  }
  // Re-read: an invoice queued while this ran must not be dropped.
  const now = await allQueued();
  await writeQueue(now.filter((x) => !sent.has(x.ref)).map((x) => (errors.has(x.ref) ? { ...x, error: errors.get(x.ref) } : x)));
  return sent.size;
}

export async function discard(ref: string) {
  await writeQueue((await allQueued()).filter((x) => x.ref !== ref));
}

/** Forget every saved screen. The queue stays (see above). */
export async function clearSaved() {
  const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  await Promise.all(names.filter((n) => n !== "queue.json").map((n) => FileSystem.deleteAsync(dir + n, { idempotent: true }).catch(() => {})));
  setOffline(false);
}
