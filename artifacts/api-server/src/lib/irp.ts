/**
 * Direct client for the government e-invoice system (IRP), in NIC's own
 * protocol, so it works on NIC's free sandbox and, with production keys, live:
 *
 * - Auth: a random 32-byte AppKey and the API login are RSA-encrypted
 *   (PKCS#1 v1.5) with the IRP's public key. The IRP returns an AuthToken and
 *   a session key (Sek) encrypted with AES-256-ECB under that AppKey.
 * - Every later request body is AES-256-ECB encrypted with the Sek, and so is
 *   every response's Data.
 *
 * ponytail: only the e-invoice system's APIs (IRN, cancel IRN, e-way bill by
 * IRN). A stand-alone e-way bill (no IRN) is NIC's separate e-way bill API with
 * its own login; add it here once a provider is chosen.
 */
import { constants, createCipheriv, createDecipheriv, publicEncrypt, randomBytes } from "node:crypto";

export const IRP_SANDBOX = "https://einv-apisandbox.nic.in";

export type IrpLogin = {
  baseUrl: string; gstin: string; clientId: string; clientSecret: string;
  username: string; password: string; publicKey: string;
};
export type IrpSession = { authToken: string; sek: Buffer; expiresAt: Date };

export class IrpError extends Error {
  code?: string;
  info?: unknown;
  constructor(message: string, code?: string, info?: unknown) {
    super(message);
    this.code = code;
    this.info = info;
  }
}

/** Accepts the key as NIC hands it out: a PEM file or its bare base64 body. */
export function toPem(key: string) {
  const k = key.trim();
  if (k.includes("BEGIN")) return k;
  const body = k.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

export function aesEncrypt(key: Buffer, plain: Buffer): string {
  const c = createCipheriv("aes-256-ecb", key, null);
  return Buffer.concat([c.update(plain), c.final()]).toString("base64");
}

export function aesDecrypt(key: Buffer, b64: string): Buffer {
  const d = createDecipheriv("aes-256-ecb", key, null);
  return Buffer.concat([d.update(Buffer.from(b64, "base64")), d.final()]);
}

/** Response Data decrypts to JSON, or (in some IRP versions) to base64 of it. */
function parseDecrypted(buf: Buffer): any {
  const text = buf.toString("utf8");
  try { return JSON.parse(text); } catch { return JSON.parse(Buffer.from(text, "base64").toString("utf8")); }
}

const headers = (l: IrpLogin, extra: Record<string, string> = {}) => ({
  "Content-Type": "application/json",
  Accept: "application/json",
  // NIC's documents spell these both ways; servers read whichever they expect.
  client_id: l.clientId, client_secret: l.clientSecret, "client-id": l.clientId, "client-secret": l.clientSecret,
  Gstin: l.gstin, user_name: l.username,
  ...extra,
});

/** First error the IRP reports, as one readable line. */
function irpFailure(body: any): IrpError {
  const details = body?.ErrorDetails ?? body?.errorDetails ?? [];
  const first = Array.isArray(details) ? details[0] : details;
  const code = first?.ErrorCode ?? first?.errorCode;
  const msg = first?.ErrorMessage ?? first?.errorMessage ?? body?.message ?? "The e-invoice system refused the request.";
  return new IrpError(`${msg}${code ? ` (IRP error ${code})` : ""}`, code ? String(code) : undefined, body?.InfoDtls);
}

async function post(url: string, init: { headers: Record<string, string>; body: unknown }, fetcher: typeof fetch): Promise<any> {
  let res: Response;
  try {
    res = await fetcher(url, { method: "POST", headers: init.headers, body: JSON.stringify(init.body), signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new IrpError("Could not reach the e-invoice system. Try again in a minute.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok && !body) throw new IrpError(`The e-invoice system answered ${res.status}.`);
  return body;
}

export async function irpAuthenticate(l: IrpLogin, fetcher: typeof fetch = fetch): Promise<IrpSession> {
  const appKey = randomBytes(32);
  const payload = { UserName: l.username, Password: l.password, AppKey: appKey.toString("base64"), ForceRefreshAccessToken: false };
  let Data: string;
  try {
    Data = publicEncrypt({ key: toPem(l.publicKey), padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(Buffer.from(JSON.stringify(payload)).toString("base64"))).toString("base64");
  } catch {
    throw new IrpError("The IRP public key could not be read. Paste the key file NIC gave you, as it is.");
  }
  const body = await post(`${l.baseUrl}/eivital/v1.04/auth`, { headers: headers(l), body: { Data } }, fetcher);
  if (String(body?.Status) !== "1") throw irpFailure(body);
  const d = body.Data ?? {};
  const sek = aesDecrypt(appKey, d.Sek);
  // NIC gives local time "yyyy-MM-dd HH:mm:ss" (IST). Fall back to 50 minutes (sandbox lasts 60).
  const expiry = d.TokenExpiry ? new Date(`${String(d.TokenExpiry).replace(" ", "T")}+05:30`) : new Date(Date.now() + 50 * 60_000);
  return { authToken: d.AuthToken, sek, expiresAt: Number.isNaN(expiry.getTime()) ? new Date(Date.now() + 50 * 60_000) : expiry };
}

/** One encrypted call with a live session. Returns the decrypted Data. */
export async function irpCall(l: IrpLogin, s: IrpSession, path: string, payload: unknown, fetcher: typeof fetch = fetch): Promise<any> {
  const Data = aesEncrypt(s.sek, Buffer.from(JSON.stringify(payload)));
  const body = await post(`${l.baseUrl}${path}`, { headers: headers(l, { AuthToken: s.authToken }), body: { Data } }, fetcher);
  if (String(body?.Status) !== "1") throw irpFailure(body);
  return typeof body.Data === "string" ? parseDecrypted(aesDecrypt(s.sek, body.Data)) : body.Data;
}

export const IRP_PATHS = {
  generate: "/eicore/v1.03/Invoice",
  cancel: "/eicore/v1.03/Invoice/Cancel",
  ewayByIrn: "/eiewb/v1.03/ewaybill",
} as const;

/** IRP error 2150 means this invoice already has an IRN: its details come back in InfoDtls. */
export function duplicateIrn(err: unknown): { Irn: string; AckNo: string; AckDt: string } | null {
  if (!(err instanceof IrpError) || err.code !== "2150") return null;
  const info = Array.isArray(err.info) ? (err.info as any[]).find((i) => i?.InfoCode === "DUPIRN") ?? err.info[0] : null;
  return info?.Desc?.Irn ? info.Desc : null;
}
