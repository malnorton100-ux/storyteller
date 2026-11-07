import path from "path";

/**
 * Where uploaded and generated files live (photos, illustrations, videos, audio).
 *
 * - On a host such as Railway, set DATA_DIR to a persistent volume (e.g. /data) so
 *   files survive redeploys. Public files go in DATA_DIR/public, private ones in
 *   DATA_DIR/private.
 * - Without DATA_DIR (local dev / Replit) the old locations are used.
 */
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;

export const PUBLIC_DATA_DIR = DATA_DIR
  ? path.join(DATA_DIR, "public")
  : path.join(process.cwd(), "client", "public");

export const PRIVATE_DATA_DIR = DATA_DIR ? path.join(DATA_DIR, "private") : process.cwd();

/** The app's public web address, e.g. https://legacyweaver.up.railway.app (no trailing slash). */
export function publicBaseUrl(): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0] || process.env.REPLIT_DEV_DOMAIN;
  if (replitDomain) return `https://${replitDomain}`;
  return `http://localhost:${process.env.PORT || 5000}`;
}

export function hasPublicUrl(): boolean {
  return !publicBaseUrl().startsWith("http://localhost");
}

/** OpenAI settings: a normal OPENAI_API_KEY, or Replit's AI integration when running there. */
export const openaiConfig = {
  // Placeholder lets the app start before a key is added; AI features will error until then.
  apiKey: process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "missing-openai-key",
  baseURL: process.env.OPENAI_API_KEY ? undefined : process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
};

/**
 * AI model names. Set OPENAI_IMAGE_MODEL / OPENAI_TEXT_MODEL in Railway to switch
 * models without a code change (e.g. when OpenAI retires one).
 * gpt-image-1 was shut down by OpenAI on 23 Oct 2026; its replacement is gpt-image-2.5-flare/-sunburst.
 */
export const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-flare";
export const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5.2";
// gpt-audio retires 20 Jan 2027 (replacement gpt-audio-1.5); gpt-4o-mini-transcribe retires 26 Feb 2027 (replacement gpt-transcribe).
export const AUDIO_MODEL = process.env.OPENAI_AUDIO_MODEL || "gpt-audio";
export const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";

/**
 * Pull the JSON array/object out of an AI reply, even if it is wrapped in
 * ```json fences or has a sentence before/after it.
 */
export function parseAiJson(raw: string | null | undefined): any {
  const text = (raw || "").replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(text);
  } catch {}
  const starts = [text.indexOf("["), text.indexOf("{")].filter((i) => i >= 0);
  if (starts.length === 0) throw new Error("No JSON found in AI reply");
  const start = Math.min(...starts);
  const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
  if (end <= start) throw new Error("Incomplete JSON in AI reply");
  return JSON.parse(text.slice(start, end + 1));
}
