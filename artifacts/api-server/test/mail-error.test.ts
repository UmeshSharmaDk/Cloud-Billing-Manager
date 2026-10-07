// describeMailError turns a mail failure into loggable fields and a pointer to the usual cause.
// It must never carry the message text, which for some failures names the server or the account.
import { describeMailError } from "../src/lib/mail-errors.ts";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  [${detail}]` : ""}`); }
};
const mk = (props: Record<string, unknown>) => Object.assign(new Error("Invalid login: 535 5.7.8 user=alice password=hunter2"), props);

const auth = describeMailError(mk({ code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" }));
check("a rejected login points at the credentials", String(auth["hint"]).includes("credentials"));
check(
  "a production SMTP failure names its production secret",
  String(describeMailError(mk({ code: "EAUTH" }), "PRODUCTION_SMTP_URL")["hint"])
    .includes("credentials in PRODUCTION_SMTP_URL"),
);
check("it keeps the codes and the command", auth["smtpCode"] === "EAUTH" && auth["smtpResponseCode"] === 535 && auth["smtpCommand"] === "AUTH PLAIN");
check("it never carries the error message", !JSON.stringify(auth).includes("hunter2") && !JSON.stringify(auth).includes("alice"));

check("a refused sender points at MAIL_FROM",
  String(describeMailError(mk({ code: "EENVELOPE", responseCode: 553 }))["hint"]).includes("MAIL_FROM"));
check("an unreachable server points at host, port and TLS",
  String(describeMailError(mk({ code: "ESOCKET", command: "CONN" }))["hint"]).includes("port"));
check("an unknown host points at the host name",
  String(describeMailError(mk({ code: "EDNS" }))["hint"]).includes("host name"));
const unknown = describeMailError("not an error object");
check("a non-error value is described without throwing", unknown["errorName"] === "UnknownError" && unknown["hint"] === undefined);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
