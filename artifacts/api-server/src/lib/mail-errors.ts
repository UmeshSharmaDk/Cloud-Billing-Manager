// Describing a mail failure in fields that are safe to log. Kept apart from mailer.ts so it can be
// tested without loading the server configuration.

/**
 * What a mail failure says, in fields that are safe to log: the error's name,
 * the SMTP codes and command, and a plain-language pointer to the usual cause.
 * Never the message text, the URL or any credential.
 */
export function describeMailError(err: unknown): Record<string, unknown> {
  const e = (err && typeof err === "object" ? err : {}) as Record<string, unknown>;
  const code = typeof e["code"] === "string" ? e["code"] : undefined;
  const responseCode = typeof e["responseCode"] === "number" ? e["responseCode"] : undefined;

  let hint: string | undefined;
  if (code === "EAUTH" || responseCode === 535 || responseCode === 534) {
    hint = "The SMTP username or password was rejected. Check the credentials in SMTP_URL (URL-encode special characters; many providers need an app password or API key).";
  } else if (code === "EENVELOPE" || (responseCode !== undefined && responseCode >= 550 && responseCode <= 554)) {
    hint = "The server refused the sender or recipient. MAIL_FROM (or its domain) usually has to be verified with the mail provider.";
  } else if (code === "ENOTFOUND" || code === "EDNS") {
    hint = "The SMTP host name in SMTP_URL does not resolve. Check it for a typo.";
  } else if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ECONNREFUSED" || code === "ESOCKET") {
    hint = "The SMTP server could not be reached or the TLS handshake failed. Check the host and port, and that the scheme matches the port (smtps:// for 465, smtp:// for 587); outbound port 25 is commonly blocked.";
  }

  return {
    errorName: typeof e["name"] === "string" ? e["name"] : "UnknownError",
    smtpCode: code,
    smtpResponseCode: responseCode,
    smtpCommand: typeof e["command"] === "string" ? e["command"] : undefined,
    hint,
  };
}
