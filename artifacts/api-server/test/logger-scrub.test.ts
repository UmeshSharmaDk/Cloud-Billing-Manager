// pino-http builds each request's logger with its own serializers, replacing the parent's, so the
// scrubbed error serializer has to be passed to pinoHttp as well. This mirrors the wiring in app.ts.
import pino from "pino";
import pinoHttp from "pino-http";
import http from "node:http";
import fs from "node:fs";
import { scrubError } from "../src/lib/logger.ts";
const lines: string[] = [];
const logger = pino({ serializers: { err: scrubError } }, { write: (l: string) => lines.push(l) } as any);
const mw = pinoHttp({ logger, serializers: { err: scrubError, req: (r: any) => ({ id: r.id }), res: (r: any) => ({ statusCode: r.statusCode }) } });
const server = http.createServer((req, res) => {
  mw(req, res);
  const err: any = new Error('Failed query: insert into "users" values ($1,$2)\nparams: victim@example.com,$argon2id$SECRETHASH');
  err.params = ["victim@example.com", "$argon2id$SECRETHASH"]; err.query = "insert";
  err.cause = Object.assign(new Error("duplicate key"), { detail: "Key (email)=(victim@example.com) already exists.", code: "23505" });
  (req as any).log.error({ err }, "Unhandled error");
  res.end("x");
});
const appSource = fs.readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
if (!/serializers:\s*\{[^}]*err:\s*scrubError/s.test(appSource)) {
  console.log("FAIL app.ts does not pass the scrubbed error serializer to pinoHttp");
  process.exit(1);
}
server.listen(0, async () => {
  await fetch(`http://127.0.0.1:${(server.address() as any).port}/`);
  const out = lines.join("\n"); server.close();
  if (/victim@|SECRETHASH/.test(out)) {
    console.log("FAIL a database error logged through req.log leaks its bound parameters\n" + out);
    process.exit(1);
  }
  console.log("  ok    a database error logged through req.log carries no bound parameters or row detail");
  console.log("\n1 passed, 0 failed");
});
