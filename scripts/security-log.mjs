import fs from "node:fs";

// CI diagnostics must never publish connection URLs, mail links, or auth tokens.
// These logs may predate the application's structured logger.
export function scrubLog(text) {
  return text
    .replace(/\b(?:postgres(?:ql)?|smtps?|https?):\/\/[^\s"'<>\\]+/gi, "[redacted-url]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]")
    .replace(/((?:authorization|(?:set-)?cookie)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\n]+)/gi, "$1[redacted]")
    .replace(/((?:SESSION_SECRET|PASSWORD|authorization|cookie|token)\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, "$1[redacted]")
    .replace(/(\\n|\n)params:[^\n]*/g, "$1params: [redacted]");
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  let found = false;
  for (const file of process.argv.slice(2)) {
    if (!fs.existsSync(file)) continue;
    found = true;
    console.log(`--- ${file} ---`);
    console.log(scrubLog(fs.readFileSync(file, "utf8").split("\n").slice(-100).join("\n")));
  }
  if (!found) console.log("No API/startup logs exist; failure occurred before server startup.");
}
