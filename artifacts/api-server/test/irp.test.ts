/** node --import tsx test/irp.test.ts — the IRP client against a fake IRP that speaks NIC's protocol. */
import { createServer } from "node:http";
import { constants, generateKeyPairSync, privateDecrypt, randomBytes } from "node:crypto";
import { aesDecrypt, aesEncrypt, duplicateIrn, irpAuthenticate, irpCall, IRP_PATHS, IrpError } from "../src/lib/irp.ts";
import { seal, unseal } from "../src/lib/secret-box.ts";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${cond || !detail ? "" : `  (${detail})`}`);
};

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const pubBare = pubPem.replace(/-----[^-]+-----|\s/g, "");
const sek = randomBytes(32);
let seen: any = {};

const server = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const body = JSON.parse(raw || "{}");
  const send = (o: unknown) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
  if (req.url === "/eivital/v1.04/auth") {
    const inner = JSON.parse(Buffer.from(privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(body.Data, "base64")).toString(), "base64").toString());
    seen.auth = { headers: req.headers, inner };
    if (inner.Password !== "secret") return send({ Status: 0, ErrorDetails: [{ ErrorCode: "1001", ErrorMessage: "Invalid username or password" }] });
    return send({ Status: 1, Data: { AuthToken: "tok-1", Sek: aesEncrypt(Buffer.from(inner.AppKey, "base64"), sek), TokenExpiry: "2030-01-01 10:00:00" } });
  }
  if (req.headers["authtoken"] !== "tok-1") return send({ Status: 0, ErrorDetails: [{ ErrorCode: "1005", ErrorMessage: "Invalid Token" }] });
  const payload = JSON.parse(aesDecrypt(sek, body.Data).toString());
  seen.call = { path: req.url, payload, headers: req.headers };
  if (req.url === IRP_PATHS.generate && payload.DocDtls?.No === "DUP-1") {
    return send({ Status: 0, ErrorDetails: [{ ErrorCode: "2150", ErrorMessage: "Duplicate IRN" }], InfoDtls: [{ InfoCode: "DUPIRN", Desc: { AckNo: 1, AckDt: "2026-11-23 10:00:00", Irn: "b".repeat(64) } }] });
  }
  return send({ Status: 1, Data: aesEncrypt(sek, Buffer.from(JSON.stringify({ AckNo: 112610000000001, AckDt: "2026-11-23 10:00:00", Irn: "a".repeat(64), SignedQRCode: "qr.jwt" }))) });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as any).port;
const login = { baseUrl: `http://127.0.0.1:${port}`, gstin: "29AAFCD5862R000", clientId: "cid", clientSecret: "csec", username: "api_user", password: "secret", publicKey: pubBare };

const s = await irpAuthenticate(login);
check("auth: login sent RSA-encrypted, with a 32-byte AppKey", seen.auth.inner.UserName === "api_user" && Buffer.from(seen.auth.inner.AppKey, "base64").length === 32);
check("auth: client and GSTIN headers sent", seen.auth.headers["client_id"] === "cid" && seen.auth.headers["client_secret"] === "csec" && seen.auth.headers["gstin"] === "29AAFCD5862R000");
check("auth: the session key is decrypted with the AppKey", s.sek.equals(sek) && s.authToken === "tok-1");
check("auth: expiry is read as IST", s.expiresAt.toISOString() === "2030-01-01T04:30:00.000Z", s.expiresAt.toISOString());

const r = await irpCall(login, s, IRP_PATHS.generate, { Version: "1.1", DocDtls: { No: "INV-1" } });
check("call: body is encrypted with the session key and the reply decrypted", seen.call.payload.DocDtls.No === "INV-1" && r.Irn === "a".repeat(64) && r.SignedQRCode === "qr.jwt");
check("call: token and user headers sent", seen.call.headers["authtoken"] === "tok-1" && seen.call.headers["user_name"] === "api_user");

try { await irpCall(login, s, IRP_PATHS.generate, { DocDtls: { No: "DUP-1" } }); check("duplicate IRN is an error", false); }
catch (e) { check("duplicate IRN hands back the existing IRN", duplicateIrn(e)?.Irn === "b".repeat(64)); }

try { await irpAuthenticate({ ...login, password: "wrong" }); check("bad login is an error", false); }
catch (e) { check("a wrong password reads as the IRP's message", e instanceof IrpError && /Invalid username/.test(e.message) && e.code === "1001"); }

try { await irpCall(login, { ...s, authToken: "old" }, IRP_PATHS.cancel, { Irn: "x" }); check("stale token is an error", false); }
catch (e) { check("a stale token carries code 1005, so the caller logs in again", e instanceof IrpError && e.code === "1005"); }

try { await irpAuthenticate({ ...login, publicKey: "not a key".repeat(20) }); check("bad key is an error", false); }
catch (e) { check("an unreadable public key says so", e instanceof IrpError && /public key/.test(e.message)); }

const box = seal("p@ss", "k1");
check("secret box: round trip", unseal(box, "k1") === "p@ss" && !box.includes("p@ss"));
check("secret box: another key cannot open it", unseal(box, "k2") === null);

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
