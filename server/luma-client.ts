import { PRIVATE_DATA_DIR, VIDEO_MODEL, VIDEO_INPUT_TEMPLATE, VIDEO_CLIP_SECONDS } from "./config";
import Replicate from "replicate";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";

let overrideToken: string | null = null;
const TOKEN_FILE = path.join(PRIVATE_DATA_DIR, ".replicate-token");

export function setReplicateToken(token: string) {
  overrideToken = token;
  try {
    fs.writeFileSync(TOKEN_FILE, token, "utf-8");
  } catch {}
  console.log(`[Replicate] Token set: ${token.substring(0, 8)}... (${token.length} chars)`);
}

function loadPersistedToken(): string | null {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const token = fs.readFileSync(TOKEN_FILE, "utf-8").trim();
      if (token.startsWith("r8_") && token.length > 10) {
        return token;
      }
    }
  } catch {}
  return null;
}

function extractToken(raw: string): string {
  const matches = Array.from(raw.matchAll(/r8_[A-Za-z0-9]+/g));
  if (matches.length > 0) {
    return matches[matches.length - 1][0];
  }
  return raw.trim();
}

function getToken(): string {
  if (overrideToken) return overrideToken;
  const persisted = loadPersistedToken();
  if (persisted) return persisted;
  const raw = process.env.REPLICATE_API_KEY || process.env.REPLICATE_API_TOKEN || "";
  return extractToken(raw);
}

function getClient(): Replicate {
  return new Replicate({
    auth: getToken(),
  });
}

/** Fill {{image}} / {{prompt}} / {{aspect_ratio}} placeholders anywhere in a JSON value. */
function fillTemplate(value: any, vars: Record<string, any>): any {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{(\w+)\}\}$/);
    if (exact && exact[1] in vars) return vars[exact[1]];
    return value.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  }
  if (Array.isArray(value)) return value.map((v) => fillTemplate(v, vars));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplate(v, vars)]));
  }
  return value;
}

/**
 * Inputs for the configured video model. Every Replicate model names its inputs
 * differently, so: use REPLICATE_VIDEO_INPUT if set, else known presets, else a
 * best-guess common shape.
 */
export function buildVideoInput(imageUrl: string | Buffer, prompt: string, aspectRatio: string): Record<string, any> {
  const vars: Record<string, any> = { image: imageUrl, prompt, aspect_ratio: aspectRatio };

  if (VIDEO_INPUT_TEMPLATE) {
    try {
      return fillTemplate(JSON.parse(VIDEO_INPUT_TEMPLATE), vars);
    } catch (e: any) {
      throw new Error(`REPLICATE_VIDEO_INPUT is not valid JSON: ${e.message}`);
    }
  }

  if (VIDEO_MODEL.startsWith("wavespeedai/wan-2.1-i2v")) {
    return {
      image: imageUrl,
      prompt,
      num_frames: 81,
      max_area: aspectRatio === "9:16" ? "480x832" : "832x480",
      frames_per_second: 16,
      sample_steps: 40,
      sample_guide_scale: 7.5,
      sample_shift: 8,
      fast_mode: "Balanced",
    };
  }

  if (VIDEO_MODEL.startsWith("kwaivgi/kling")) {
    return { prompt, start_image: imageUrl, duration: VIDEO_CLIP_SECONDS };
  }

  // Unknown model: most image-to-video models take a prompt plus an image called
  // "image" or "start_image". If this fails, set REPLICATE_VIDEO_INPUT.
  console.warn(`[Replicate] No preset for ${VIDEO_MODEL} - using a generic input. Set REPLICATE_VIDEO_INPUT if it fails.`);
  return { prompt, start_image: imageUrl };
}

export async function animateImageToVideo(
  imageUrl: string | Buffer,
  prompt: string,
  aspectRatio: "16:9" | "9:16" | "1:1" = "16:9"
): Promise<string> {
  const client = getClient();
  console.log(`[Replicate] Generating REAL AI VIDEO CLIP (not slideshow)...`);
  console.log(`[Replicate] Prompt: ${prompt.substring(0, 200)}...`);
  console.log(`[Replicate] Image: ${typeof imageUrl === "string" ? imageUrl : `uploaded file (${imageUrl.length} bytes)`}`);

  const input = buildVideoInput(imageUrl, prompt, aspectRatio);
  console.log(`[Replicate] Model: ${VIDEO_MODEL}`);

  const prediction = await client.predictions.create({
    model: VIDEO_MODEL,
    input,
  } as any);

  console.log(`[Replicate] Prediction created: ${prediction.id}, waiting for AI video...`);

  let attempts = 0;
  const maxAttempts = 160; // ~8 minutes per clip, then give up on that clip

  while (attempts < maxAttempts) {
    const updated = await client.predictions.get(prediction.id);

    if (updated.status === "succeeded") {
      const output = updated.output;
      let videoUrl: string | null = null;

      if (typeof output === "string") {
        videoUrl = output;
      } else if (Array.isArray(output) && output.length > 0) {
        const first = output[0];
        videoUrl = typeof first === "string" ? first : first?.url || null;
      } else if (output && typeof output === "object") {
        videoUrl = (output as any).url || (output as any).video || null;
      }

      if (!videoUrl) {
        console.error("[Replicate] Unexpected output:", JSON.stringify(output));
        throw new Error("No video URL in Replicate output");
      }

      console.log(`[Replicate] REAL AI VIDEO CLIP ready: ${videoUrl}`);
      return videoUrl;
    } else if (updated.status === "failed" || updated.status === "canceled") {
      const errorMsg = updated.error || "unknown error";
      throw new Error(`Replicate video generation failed: ${errorMsg}`);
    }

    if (attempts % 10 === 0) {
      console.log(`[Replicate] Status: ${updated.status} (${attempts * 3}s elapsed, waiting for AI video...)`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
    attempts++;
  }

  throw new Error("Replicate video generation timed out after 10 minutes");
}

export async function downloadVideo(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const file = fs.createWriteStream(outputPath);

    const makeRequest = (reqUrl: string, redirectCount = 0) => {
      if (redirectCount > 10) {
        reject(new Error("Too many redirects"));
        return;
      }
      const protocol = reqUrl.startsWith("https") ? https : http;
      protocol.get(reqUrl, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          makeRequest(response.headers.location, redirectCount + 1);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download video: HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      }).on("error", (err) => {
        fs.unlink(outputPath, () => {});
        reject(err);
      });
    };

    makeRequest(url);
  });
}

export function isLumaConfigured(): boolean {
  const token = getToken();
  return !!(token && token.length > 5 && token.startsWith("r8_"));
}

export async function validateAndFixToken(): Promise<boolean> {
  const token = getToken();
  if (!token || !token.startsWith("r8_")) {
    console.log("[Replicate] No token found");
    return false;
  }

  try {
    const client = new Replicate({ auth: token });
    await client.predictions.list();
    console.log(`[Replicate] Token validated OK: ${token.substring(0, 8)}...`);
    return true;
  } catch (e: any) {
    console.log(`[Replicate] Token ${token.substring(0, 8)}... failed: ${e.message?.substring(0, 100)}`);
    const raw = process.env.REPLICATE_API_KEY || process.env.REPLICATE_API_TOKEN || "";
    const allMatches = Array.from(raw.matchAll(/r8_[A-Za-z0-9]+/g));
    for (const match of allMatches) {
      const candidate = match[0];
      if (candidate === token) continue;
      try {
        const testClient = new Replicate({ auth: candidate });
        await testClient.predictions.list();
        console.log(`[Replicate] Found working token: ${candidate.substring(0, 8)}...`);
        setReplicateToken(candidate);
        return true;
      } catch {}
    }
    console.log("[Replicate] No working token found in environment");
    return false;
  }
}
