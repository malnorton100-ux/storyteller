import { PRIVATE_DATA_DIR, VIDEO_MODEL, VIDEO_INPUT_TEMPLATE, VIDEO_CLIP_SECONDS, VOICE_CLONE_MODEL, VOICE_CLONE_INPUT, VOICE_CLONE_LANGUAGE } from "./config";
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

/**
 * Download a finished clip. Each attempt gives up if the connection goes quiet
 * for 45s or takes more than 3 minutes in total (a stalled download used to hang
 * the whole movie forever), and is retried up to 3 times.
 */
export async function downloadVideo(url: string, outputPath: string): Promise<void> {
  let lastErr: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await downloadOnce(url, outputPath);
      const size = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
      if (size < 1000) throw new Error(`Downloaded clip is too small (${size} bytes)`);
      return;
    } catch (err: any) {
      lastErr = err;
      console.warn(`[Replicate] Clip download attempt ${attempt} failed: ${err?.message}`);
      try { fs.unlinkSync(outputPath); } catch {}
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw lastErr;
}

function downloadOnce(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(overall);
      if (err) reject(err);
      else resolve();
    };
    let currentReq: any = null;
    const overall = setTimeout(() => {
      currentReq?.destroy(new Error("Download took longer than 3 minutes"));
      finish(new Error("Download took longer than 3 minutes"));
    }, 3 * 60 * 1000);

    const makeRequest = (reqUrl: string, redirectCount = 0) => {
      if (redirectCount > 10) return finish(new Error("Too many redirects"));
      const protocol = reqUrl.startsWith("https") ? https : http;
      const req = protocol.get(reqUrl, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          makeRequest(new URL(response.headers.location, reqUrl).toString(), redirectCount + 1);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          return finish(new Error(`Failed to download video: HTTP ${response.statusCode}`));
        }
        const file = fs.createWriteStream(outputPath);
        response.on("error", (e) => finish(e));
        file.on("error", (e) => finish(e));
        file.on("finish", () => file.close(() => finish()));
        response.pipe(file);
      });
      currentReq = req;
      req.setTimeout(45000, () => req.destroy(new Error("Download stalled (no data for 45s)")));
      req.on("error", (err) => finish(err));
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


// ── Own-voice narration ──────────────────────────────────────────────────
function buildVoiceInput(text: string, refAudio: Buffer): Record<string, any> {
  const vars: Record<string, any> = { text, audio: refAudio, language: VOICE_CLONE_LANGUAGE };
  if (VOICE_CLONE_INPUT) {
    try {
      return fillTemplate(JSON.parse(VOICE_CLONE_INPUT), vars);
    } catch (e: any) {
      throw new Error(`VOICE_CLONE_INPUT is not valid JSON: ${e.message}`);
    }
  }
  if (VOICE_CLONE_MODEL.includes("chatterbox-multilingual")) {
    // cfg_weight a bit lower = slower, calmer delivery - suits storytelling.
    return { text_to_synthesize: text, reference_audio: refAudio, language_id: VOICE_CLONE_LANGUAGE, cfg_weight: 0.4, exaggeration: 0.5 };
  }
  if (VOICE_CLONE_MODEL.includes("chatterbox")) {
    return { prompt: text, audio_prompt: refAudio, cfg_weight: 0.4, exaggeration: 0.5 };
  }
  return { text, reference_audio: refAudio };
}

/**
 * Speak `text` in the voice from `refAudio` (a short clean WAV of the storyteller).
 * Returns the audio file's contents. Keep each `text` under ~300 characters.
 */
export async function speakInOwnVoice(text: string, refAudio: Buffer): Promise<Buffer> {
  const client = getClient();
  const prediction = await client.predictions.create({ model: VOICE_CLONE_MODEL, input: buildVoiceInput(text, refAudio) } as any);

  for (let attempts = 0; attempts < 60; attempts++) {
    const updated = await client.predictions.get(prediction.id);
    if (updated.status === "succeeded") {
      const out: any = updated.output;
      const url = typeof out === "string" ? out : Array.isArray(out) ? (typeof out[0] === "string" ? out[0] : out[0]?.url) : out?.url || out?.audio || out?.audio_out;
      if (!url || typeof url !== "string") throw new Error(`No audio in voice output: ${JSON.stringify(out).slice(0, 200)}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Voice download failed: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    if (updated.status === "failed" || updated.status === "canceled") {
      throw new Error(`Voice generation failed: ${updated.error || "unknown error"}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Voice generation timed out");
}
