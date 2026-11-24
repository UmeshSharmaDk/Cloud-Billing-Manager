/**
 * Seals small secrets (an API password) before they go into the database, so a
 * database dump alone does not hand them over. AES-256-GCM, key derived from
 * SESSION_SECRET: rotating that secret makes stored ones unreadable, and the
 * user is asked to enter them again.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const keyFrom = (secret: string) => createHash("sha256").update(`secret-box:v1:${secret}`).digest();

export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64")}`;
}

/** `null` when it was sealed with another key (or tampered with). */
export function unseal(sealed: string, secret: string): string | null {
  if (!sealed.startsWith("v1.")) return null;
  const raw = Buffer.from(sealed.slice(3), "base64");
  try {
    const d = createDecipheriv("aes-256-gcm", keyFrom(secret), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
