import { db, irpCredentialsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { config } from "./config";
import { IrpError, irpAuthenticate, irpCall, type IrpLogin, type IrpSession } from "./irp";
import { seal, unseal } from "./secret-box";

/** Tests point this at a fake IRP. */
const override = () => process.env["IRP_BASE_URL"]?.trim() || null;

export async function loadLogin(businessId: number): Promise<{ login: IrpLogin; session: IrpSession | null } | null> {
  const [row] = await db.select().from(irpCredentialsTable).where(eq(irpCredentialsTable.businessId, businessId)).limit(1);
  if (!row) return null;
  const clientSecret = unseal(row.clientSecret, config.jwtSecret);
  const password = unseal(row.password, config.jwtSecret);
  if (clientSecret === null || password === null) {
    throw new IrpError("The saved e-invoice login can no longer be read. Enter it again in Settings.");
  }
  const sek = row.sek ? unseal(row.sek, config.jwtSecret) : null;
  const live = row.authToken && sek && row.tokenExpiry && row.tokenExpiry.getTime() > Date.now() + 5 * 60_000;
  return {
    login: { baseUrl: override() ?? row.baseUrl, gstin: row.gstin, clientId: row.clientId, clientSecret, username: row.username, password, publicKey: row.publicKey },
    session: live ? { authToken: row.authToken!, sek: Buffer.from(sek!, "base64"), expiresAt: row.tokenExpiry! } : null,
  };
}

async function freshSession(businessId: number, login: IrpLogin) {
  const s = await irpAuthenticate(login);
  await db.update(irpCredentialsTable)
    .set({ authToken: s.authToken, sek: seal(s.sek.toString("base64"), config.jwtSecret), tokenExpiry: s.expiresAt })
    .where(eq(irpCredentialsTable.businessId, businessId));
  return s;
}

/**
 * One IRP call for a business, logging in when there is no live token, and
 * once more if the IRP says the token is no longer valid.
 */
export async function callIrp(businessId: number, path: string, payload: unknown): Promise<any> {
  const saved = await loadLogin(businessId);
  if (!saved) throw new IrpError("Set up the e-invoice login in Settings first.", "NO_LOGIN");
  const session = saved.session ?? await freshSession(businessId, saved.login);
  try {
    return await irpCall(saved.login, session, path, payload);
  } catch (err) {
    // 1005: invalid token; 1004: header GSTIN or user mismatch after a re-login elsewhere.
    if (saved.session && err instanceof IrpError && (err.code === "1005" || err.code === "1004")) {
      return irpCall(saved.login, await freshSession(businessId, saved.login), path, payload);
    }
    throw err;
  }
}

export async function saveLogin(businessId: number, l: IrpLogin) {
  const row = {
    businessId, baseUrl: l.baseUrl, gstin: l.gstin.toUpperCase(), clientId: l.clientId, username: l.username, publicKey: l.publicKey.trim(),
    clientSecret: seal(l.clientSecret, config.jwtSecret), password: seal(l.password, config.jwtSecret),
    authToken: null, sek: null, tokenExpiry: null, updatedAt: new Date(),
  };
  await db.insert(irpCredentialsTable).values(row).onConflictDoUpdate({ target: irpCredentialsTable.businessId, set: row });
}
