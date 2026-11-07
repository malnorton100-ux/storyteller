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
  apiKey: process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_KEY ? undefined : process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
};
