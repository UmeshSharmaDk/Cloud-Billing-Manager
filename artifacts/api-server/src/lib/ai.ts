/**
 * Google Gemini over its REST API, with the key from GOOGLE_API_KEY. A plain
 * fetch keeps the SDK out of the bundle. The key goes in a header, so it never
 * shows up in a logged URL.
 */

export const AI_MODEL = process.env["AI_MODEL"] || "gemini-2.5-flash";
// AI_API_BASE only exists so the integration suite can point at a fake.
const ENDPOINT = (model: string, env: NodeJS.ProcessEnv) =>
  `${env["AI_API_BASE"] || "https://generativelanguage.googleapis.com"}/v1beta/models/${model}:generateContent`;
const CALL_TIMEOUT_MS = 25_000;

/** A failure the caller can show as it is. */
export class AiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const aiConfigured = (env = process.env) => Boolean(env["GOOGLE_API_KEY"]);

export type Part = Record<string, unknown>;
export type Content = { role: "user" | "model"; parts: Part[] };

export interface GenerateRequest {
  system: string;
  contents: Content[];
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  /** When given, the reply is JSON in this shape. */
  schema?: Record<string, unknown>;
}

/** One call. Returns the model's reply content (text and/or function calls). */
export async function generate(req: GenerateRequest, env = process.env, fetchImpl: typeof fetch = fetch): Promise<Content> {
  const key = env["GOOGLE_API_KEY"];
  if (!key) throw new AiError("AI isn't set up yet. Ask your administrator to add the AI key.", 503);
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: req.contents,
    generationConfig: req.schema
      ? { temperature: 0.1, responseMimeType: "application/json", responseSchema: req.schema }
      : { temperature: 0.2 },
  };
  if (req.tools?.length) body["tools"] = [{ functionDeclarations: req.tools }];

  let res: Response;
  try {
    res = await fetchImpl(ENDPOINT(AI_MODEL, env), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch {
    throw new AiError("The AI took too long to answer. Try again.", 504);
  }
  if (res.status === 429) throw new AiError("The AI is busy right now. Try again in a minute.", 503);
  if (!res.ok) throw new AiError("The AI could not answer just now. Try again.", 502);
  const data: any = await res.json();
  const content = data?.candidates?.[0]?.content;
  if (!content?.parts?.length) throw new AiError("The AI could not answer that. Try rewording it.", 502);
  return { role: "model", parts: content.parts };
}

export const textOf = (c: Content) => c.parts.map((p) => (typeof p["text"] === "string" && !p["thought"] ? p["text"] : "")).join("").trim();

/** For calls made with `schema`. */
export function jsonOf<T>(c: Content): T {
  try {
    return JSON.parse(textOf(c)) as T;
  } catch {
    throw new AiError("The AI's answer could not be read. Try again.", 502);
  }
}

/**
 * AI actions each business may use per day (Indian date), AI_DAILY_LIMIT, default 50.
 * ponytail: per-process map, resets on restart; it caps cost rather than bills it.
 * Move to a table if the app ever runs on more than one server.
 */
const used = new Map<string, number>();
export function takeAiCredit(businessId: number, env = process.env, now = new Date()): boolean {
  const limit = Number(env["AI_DAILY_LIMIT"] ?? 50);
  const day = new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const key = `${businessId}:${day}`;
  const n = used.get(key) ?? 0;
  if (n >= limit) return false;
  if (used.size > 10_000) used.clear();
  used.set(key, n + 1);
  return true;
}

/** Shared by every prompt: Hindi in, Hindi out. */
export const LANGUAGE_RULE =
  "Reply in the language the user wrote in. If they wrote in Hindi (Devanagari) or in Hinglish (Hindi in Latin letters), " +
  "reply in Hindi in Devanagari script. Keep numbers, amounts, GSTINs, HSN codes and invoice numbers in digits.";

/** The GST rates the invoice and purchase forms offer; anything else snaps to the nearest. */
export const APP_GST_RATES = [0, 5, 12, 18, 28];
export const appRate = (n: unknown, fallback = 18) =>
  Number.isFinite(Number(n)) ? APP_GST_RATES.reduce((a, b) => (Math.abs(b - Number(n)) < Math.abs(a - Number(n)) ? b : a)) : fallback;
