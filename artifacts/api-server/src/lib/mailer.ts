/**
 * Sending mail.
 *
 * There is exactly one thing this sends today — the two registration outcomes —
 * and the interface is deliberately no larger than that. Both messages exist
 * because the HTTP response to `POST /auth/register` must not reveal whether an
 * address already has an account, so the answer travels by email instead.
 *
 * The two messages are the whole point of the design, so they are written here
 * next to each other rather than in a template directory: whoever changes one
 * should be looking at the other, because the pair only works if neither can be
 * inferred from the HTTP response.
 */

import fs from "node:fs";
import nodemailer from "nodemailer";
import { config } from "./config";
import { logger } from "./logger";

export interface Message {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: Message): Promise<void>;
}

/**
 * Writes the message to the log instead of sending it.
 *
 * Only reachable with NODE_ENV=development — `config.ts` refuses to start
 * otherwise — because a transport that "sends" mail by printing it would make
 * registration silently undeliverable, and print a live credential while doing
 * it.
 */
class LogMailer implements Mailer {
  async send(message: Message): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      "Mail (development transport — not actually sent)",
    );
  }
}

/**
 * Appends each message to a file as one JSON object per line.
 *
 * For the integration suite, which needs to read a verification link and has no
 * mail server. Using this rather than the log transport lets the suite run the
 * server with NODE_ENV=production — so what it tests is the configuration that
 * ships, not a development variant of it.
 */
class FileMailer implements Mailer {
  constructor(private readonly path: string) {}

  async send(message: Message): Promise<void> {
    await fs.promises.appendFile(this.path, JSON.stringify({ ...message, at: new Date().toISOString() }) + "\n");
  }
}

class SmtpMailer implements Mailer {
  private readonly transport: nodemailer.Transporter;

  constructor(private readonly url: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(message: Message): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

function selectMailer(): Mailer {
  switch (config.mail.kind) {
    case "smtp": return new SmtpMailer(config.mail.url, config.mail.from);
    case "file": return new FileMailer(config.mail.path);
    case "log": return new LogMailer();
  }
}

export const mailer: Mailer = selectMailer();

/**
 * Sent when the address is free: here is the link that finishes your signup.
 */
export function verificationMessage(to: string, name: string, link: string): Message {
  return {
    to,
    subject: "Confirm your GST Platform account",
    text: [
      `Hello ${name},`,
      "",
      "Someone — we hope you — asked to create a GST Platform account with this",
      "address. Open the link below to finish setting it up:",
      "",
      link,
      "",
      "The link works once and expires in 24 hours.",
      "",
      "If this was not you, ignore this message. No account has been created and",
      "nothing will happen.",
    ].join("\n"),
  };
}

/**
 * Sent when the address is already registered.
 *
 * Deliberately contains no link and creates nothing. Its only job is to make
 * the taken-address case produce the *same* HTTP response as the free one while
 * still telling the person who actually owns the mailbox what happened — which
 * is also a useful warning that someone is probing for their account.
 */
export function alreadyRegisteredMessage(to: string): Message {
  return {
    to,
    subject: "Someone tried to register your GST Platform address",
    text: [
      "Hello,",
      "",
      "Someone asked to create a GST Platform account using this address, but it",
      "already has one. No second account was created and nothing has changed.",
      "",
      "If this was you, sign in as usual — or use the password reset if you have",
      "forgotten which password you set.",
      "",
      "If it was not you, someone may be checking whether you have an account",
      "here. Your account is unaffected, but it is worth making sure the password",
      "on it is one you do not use anywhere else.",
    ].join("\n"),
  };
}

/**
 * Send without letting a mail failure change what the caller returns.
 *
 * Registration must answer identically in both cases, and that has to hold when
 * the mail server is down too: if a delivery failure turned into a 500 on one
 * path and a 202 on the other, the outage would reopen the very oracle this
 * closes. The failure is logged loudly instead.
 */
export async function sendQuietly(message: Message): Promise<void> {
  try {
    await mailer.send(message);
  } catch (err) {
    logger.error({ err, subject: message.subject }, "Could not send mail");
  }
}
