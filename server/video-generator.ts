import { PUBLIC_DATA_DIR, publicBaseUrl } from "./config";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { animateImageToVideo, downloadVideo, isLumaConfigured } from "./luma-client";
import { textToSpeech } from "./replit_integrations/audio/client";

const execAsync = promisify(exec);

interface SceneInput {
  imagePath: string;
  caption: string;
  /** What actually happens in this scene (from the story), used to direct the motion. */
  action?: string;
}

interface NarrationConfig {
  enabled: boolean;
  voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  voiceSampleUrl?: string | null;
}

function getPublicImageUrl(imagePath: string): string {
  const relativePath = imagePath.replace(path.join(PUBLIC_DATA_DIR), "");
  return `${publicBaseUrl()}${relativePath.split(path.sep).join("/")}`;
}

async function probeClipDuration(clipPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${clipPath}"`,
      { timeout: 10000 }
    );
    const duration = parseFloat(stdout.trim());
    if (isNaN(duration) || duration <= 0) return 5;
    return duration;
  } catch {
    return 5;
  }
}

// Gentle camera moves, varied per scene. Deliberately no set "walk away / turn back"
// actions: those fought the picture and made people walk backwards.
const CAMERA_MOVES = [
  "Slow, gentle push-in towards the main person.",
  "Smooth, slow pan following the action.",
  "Steady camera with a very slight drift.",
  "Slow pull-back revealing more of the place.",
];

async function generateAIVideoClip(
  scene: SceneInput,
  sceneIndex: number,
  outputDir: string,
  storyTitle: string
): Promise<string> {
  const publicUrl = getPublicImageUrl(scene.imagePath);
  console.log(`[VideoGen] Scene ${sceneIndex + 1} — generating REAL AI VIDEO CLIP`);
  console.log(`[VideoGen] Scene ${sceneIndex + 1} public URL: ${publicUrl}`);

  const camera = CAMERA_MOVES[sceneIndex % CAMERA_MOVES.length];
  const action = (scene.action || scene.caption).replace(/\[STORYTELLER\]/g, "").slice(0, 600);

  // Describe what happens in THIS scene, and keep movement natural.
  const prompt = `${scene.caption}. ${action} People move naturally and in the direction they are facing - walking forwards, never backwards. Realistic body movement, natural pace, faces stay consistent. Small natural motion in the surroundings (water, wind, light). ${camera} Warm, nostalgic, cinematic. No text.`;

  // Send the picture itself (the Replicate client uploads it) rather than a link,
  // so it works even if Replicate can't reach this server's address.
  const imageData = fs.readFileSync(scene.imagePath);
  const remoteVideoUrl = await animateImageToVideo(imageData, prompt, "16:9");

  const clipFilename = `clip-scene-${sceneIndex}-${Date.now()}.mp4`;
  const clipPath = path.join(outputDir, clipFilename);
  await downloadVideo(remoteVideoUrl, clipPath);

  const duration = await probeClipDuration(clipPath);
  const fileSize = fs.statSync(clipPath).size;
  console.log(`[VideoGen] Scene ${sceneIndex + 1} AI VIDEO CLIP downloaded: ${clipPath} (${duration.toFixed(1)}s, ${(fileSize / 1024 / 1024).toFixed(1)}MB)`);

  if (fileSize < 50000) {
    throw new Error(`Scene ${sceneIndex + 1} video file too small (${fileSize} bytes) — likely not a real video`);
  }

  return clipPath;
}

async function generateNarrationAudio(
  captions: string[],
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
  tempDir: string
): Promise<string[]> {
  const audioPaths: string[] = [];

  for (let i = 0; i < captions.length; i++) {
    const caption = captions[i];
    console.log(`[VideoGen] Generating narration for scene ${i + 1}: "${caption.substring(0, 60)}..."`);

    try {
      const audioBuffer = await textToSpeech(caption, voice, "wav");
      const audioPath = path.join(tempDir, `narration-${i}-${Date.now()}.wav`);
      fs.writeFileSync(audioPath, audioBuffer);

      const duration = await probeClipDuration(audioPath);
      console.log(`[VideoGen] Narration ${i + 1} generated: ${duration.toFixed(1)}s`);
      audioPaths.push(audioPath);
    } catch (err: any) {
      console.error(`[VideoGen] Narration ${i + 1} failed: ${err.message}`);
      audioPaths.push("");
    }
  }

  return audioPaths;
}

/**
 * Output size based on a clip's shape: longest side at most MAX_SIDE, even numbers.
 * Kept modest on purpose - big frames made ffmpeg run out of memory on a small server.
 */
const MAX_SIDE = Number(process.env.VIDEO_MAX_SIDE || 960);
async function targetSize(clip: string): Promise<{ width: number; height: number }> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height:stream_side_data=rotation -of json "${clip}"`,
      { timeout: 10000 }
    );
    const st = JSON.parse(stdout).streams?.[0] || {};
    let w = Number(st.width), h = Number(st.height);
    const rot = Math.abs(Number(st.side_data_list?.[0]?.rotation || 0));
    if (rot === 90 || rot === 270) [w, h] = [h, w];
    if (!w || !h) throw new Error("no size");
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
    return { width: even(w), height: even(h) };
  } catch {
    return { width: 960, height: 540 };
  }
}

// Low-memory encoder settings: few threads, short look-ahead.
const X264_LOWMEM = `-c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -threads 2 -x264-params rc-lookahead=10`;

/** Run ffmpeg and, if it fails, log the useful last lines of its output. */
async function runFfmpeg(cmd: string, timeout: number, step: string): Promise<void> {
  try {
    await execAsync(`${cmd} 2>&1`, { timeout, maxBuffer: 20 * 1024 * 1024 });
  } catch (err: any) {
    const out = String(err.stdout || err.stderr || "").trim().split("\n").slice(-8).join(" | ");
    const why = /Killed/.test(out) ? " (server ran out of memory)" : err.killed ? " (timed out)" : "";
    console.error(`[VideoGen] ffmpeg failed at "${step}"${why}: ${out || err.message}`);
    throw new Error(`ffmpeg failed at ${step}${why}`);
  }
}

/** Join same-format clips with soft fades. */
async function joinWithTransitions(clips: string[], durations: number[], transition: number, out: string): Promise<void> {
  if (clips.length === 1) {
    fs.copyFileSync(clips[0], out);
    return;
  }
  // One decode thread per input: the server reports many CPUs, and ffmpeg would
  // otherwise start a thread (and memory) for each one.
  const inputs = clips.map((p) => `-threads 1 -i "${p}"`).join(" ");
  const names = ["fade", "dissolve", "fadeblack"];
  const chain: string[] = [];
  let last = "0:v";
  let offset = 0;
  for (let i = 1; i < clips.length; i++) {
    offset += durations[i - 1] - transition;
    const label = i < clips.length - 1 ? `x${i}` : "outv";
    chain.push(`[${last}][${i}:v]xfade=transition=${names[i % names.length]}:duration=${transition.toFixed(2)}:offset=${offset.toFixed(3)}[${label}]`);
    last = label;
  }
  await runFfmpeg(
    `ffmpeg -y -filter_threads 1 ${inputs} -filter_complex "${chain.join(";")}" -map "[outv]" ${X264_LOWMEM} -movflags +faststart -an "${out}"`,
    300000,
    "add transitions"
  );
}

/**
 * Build the finished movie from AI clips (+ optional narration per scene).
 *  1. Each scene lasts at least as long as its narration: clips play at normal
 *     speed (no jerky slow-motion); narration may be spoken up to 12% faster, and
 *     only if still longer is the last frame held.
 *  2. Every clip is converted to the same size/shape/frame rate (one at a time,
 *     low memory) so they can be joined with fades.
 *  3. Narration for each scene is placed exactly under that scene.
 * If fades fail the clips are joined without them, so the movie is never lost.
 */
async function stitchClipsWithTransitions(
  clipPaths: string[],
  outputPath: string,
  narrationPaths?: string[]
): Promise<void> {
  if (clipPaths.length === 0) throw new Error("No clips to stitch");

  const n = clipPaths.length;
  const nar = (narrationPaths || []).slice(0, n);
  while (nar.length < n) nar.push("");
  const hasNarration = nar.some((p) => p);

  const clipDur: number[] = [];
  for (const c of clipPaths) clipDur.push(await probeClipDuration(c));
  const narDur: number[] = [];
  for (const p of nar) narDur.push(p ? await probeClipDuration(p) : 0);

  const T = n > 1 ? Math.min(0.8, Math.min(...clipDur) * 0.3) : 0; // fade length
  // Smooth playback: never slow the clip down (that repeats frames and looks jerky).
  // If a narration is a little longer than its clip, speak it up to 12% faster;
  // only if it is still longer, hold the scene's last frame for the remainder.
  const tempo = clipDur.map((d, i) => {
    if (!narDur[i]) return 1;
    const room = d - (i < n - 1 ? T : 0) - 0.4; // time this scene is on screen on its own
    return Math.min(1.12, Math.max(1, narDur[i] / Math.max(1, room)));
  });
  const sceneDur = clipDur.map((d, i) => {
    const overlap = i < n - 1 ? T : 0;
    const needed = narDur[i] ? narDur[i] / tempo[i] + 0.4 + overlap : 0;
    return Math.max(d, needed);
  });

  const { width: W, height: H } = await targetSize(clipPaths[0]);
  const workDir = path.join(path.dirname(outputPath), `work-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });
  const cleanup = () => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} };

  try {
    // 1+2. Normalise each clip on its own (keeps memory low).
    const normPaths: string[] = [];
    for (let i = 0; i < n; i++) {
      const np = path.join(workDir, `n${i}.mp4`);
      const hold = Math.max(0, sceneDur[i] - clipDur[i]);
      if (hold > 0.5) console.warn(`[VideoGen] Scene ${i + 1}: narration is longer than the clip, holding the last frame ${hold.toFixed(1)}s`);
      const vf = [
        `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`,
        `setsar=1`,
        `setpts=PTS-STARTPTS`,
        `fps=24`,
        hold > 0.05 ? `tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)}` : "",
        `format=yuv420p`,
      ].filter(Boolean).join(",");
      await runFfmpeg(
        `ffmpeg -y -filter_threads 1 -threads 1 -i "${clipPaths[i]}" -vf "${vf}" -t ${sceneDur[i].toFixed(3)} ${X264_LOWMEM} -an "${np}"`,
        240000,
        `prepare scene ${i + 1}`
      );
      normPaths.push(np);
    }
    const realDur: number[] = [];
    for (const np of normPaths) realDur.push(await probeClipDuration(np));

    // 2b. Join.
    const videoOnly = hasNarration ? path.join(workDir, "video.mp4") : outputPath;
    console.log(`[VideoGen] Joining ${n} scene(s) at ${W}x${H}${hasNarration ? " with narration" : ""}...`);
    let usedFades = true;
    try {
      await joinWithTransitions(normPaths, realDur, T, videoOnly);
    } catch (err: any) {
      usedFades = false;
      console.warn(`[VideoGen] Fades failed, joining without them: ${err.message}`);
      const listPath = path.join(workDir, "list.txt");
      fs.writeFileSync(listPath, normPaths.map((p) => `file '${p}'`).join("\n"));
      await runFfmpeg(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy -movflags +faststart "${videoOnly}"`, 120000, "join scenes");
    }
    if (!hasNarration) return;

    // 3. Narration track: each scene's voice starts when that scene starts.
    const overlap = usedFades ? T : 0;
    const segLen = realDur.map((d, i) => (i < n - 1 ? d - overlap : d));
    const audioInputs: string[] = [];
    const parts: string[] = [];
    nar.forEach((p, i) => {
      const L = Math.max(0.1, segLen[i]).toFixed(3);
      if (p) {
        const k = audioInputs.length;
        audioInputs.push(`-i "${p}"`);
        const speed = tempo[i] > 1.001 ? `atempo=${tempo[i].toFixed(3)},` : "";
        parts.push(`[${k}:a]aresample=44100,${speed}aformat=sample_fmts=fltp:channel_layouts=mono,apad=whole_dur=${L},atrim=0:${L}[s${i}]`);
      } else {
        parts.push(`anullsrc=r=44100:cl=mono,aformat=sample_fmts=fltp,atrim=0:${L}[s${i}]`);
      }
    });
    parts.push(`${nar.map((_, i) => `[s${i}]`).join("")}concat=n=${n}:v=0:a=1[aout]`);
    const audioPath = path.join(workDir, "narration.m4a");
    try {
      await runFfmpeg(
        `ffmpeg -y ${audioInputs.join(" ")} -filter_complex "${parts.join(";")}" -map "[aout]" -c:a aac -b:a 128k "${audioPath}"`,
        120000,
        "build narration"
      );
      await runFfmpeg(
        `ffmpeg -y -i "${videoOnly}" -i "${audioPath}" -map 0:v -map 1:a -c:v copy -c:a copy -shortest -movflags +faststart "${outputPath}"`,
        120000,
        "add narration"
      );
      console.log("[VideoGen] Narration added under each scene");
    } catch (err: any) {
      console.error(`[VideoGen] Narration failed, keeping the silent movie: ${err.message}`);
      fs.copyFileSync(videoOnly, outputPath);
    }
  } finally {
    cleanup();
  }
}

/** Log how much storage is free, so a full disk is obvious in the logs. */
export function logFreeSpace(dir: string) {
  try {
    const st = (fs as any).statfsSync(dir);
    const freeMb = Math.round((st.bavail * st.bsize) / 1024 / 1024);
    const totalMb = Math.round((st.blocks * st.bsize) / 1024 / 1024);
    console.log(`[VideoGen] Storage: ${freeMb} MB free of ${totalMb} MB`);
    if (freeMb < 300) console.warn(`[VideoGen] WARNING: storage almost full (${freeMb} MB free)`);
  } catch {}
}

/**
 * Remove leftovers from movies that failed or were interrupted (e.g. by a
 * redeploy): temp clip folders, work folders and half-made files. Runs on start-up.
 */
export function cleanUpVideoLeftovers() {
  const dir = path.join(PUBLIC_DATA_DIR, "videos");
  if (!fs.existsSync(dir)) return;
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (/^(temp-clips-|work-|norm-)/.test(name) || /^(narration-|gap-silence-|silence-)/.test(name) || /-videoonly\.mp4$/.test(name)) {
      try { fs.rmSync(full, { recursive: true, force: true }); removed++; } catch {}
    }
  }
  if (removed) console.log(`[VideoGen] Cleaned up ${removed} leftover temporary item(s)`);
  logFreeSpace(dir);
}

export async function generateVideoFromScenes(
  scenes: SceneInput[],
  outputFilename: string,
  title: string,
  narration?: NarrationConfig
): Promise<string> {
  if (!scenes || scenes.length === 0) {
    throw new Error("No scenes provided for video generation");
  }

  for (const scene of scenes) {
    if (!fs.existsSync(scene.imagePath)) {
      throw new Error(`Scene image not found: ${scene.imagePath}`);
    }
  }

  if (!isLumaConfigured()) {
    throw new Error("AI video generation requires a Replicate API token with credits. Please add credits at replicate.com/account/billing. Slideshow fallback is disabled — only real AI video clips are generated.");
  }

  const outputDir = path.join(PUBLIC_DATA_DIR, "videos");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  logFreeSpace(outputDir);
  const outputPath = path.join(outputDir, outputFilename);
  const tempDir = path.join(outputDir, "temp-clips-" + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });

  const clipResults: (string | null)[] = new Array(scenes.length).fill(null);
  const failedScenes: number[] = [];
  let creditError: string | null = null;

  const CONCURRENCY = 2;
  let nextIdx = 0;

  async function processClip(): Promise<void> {
    while (nextIdx < scenes.length) {
      if (creditError) return;
      const i = nextIdx++;
      const scene = scenes[i];
      console.log(`[VideoGen] Scene ${i + 1}/${scenes.length}: Generating REAL AI VIDEO CLIP...`);

      try {
        clipResults[i] = await generateAIVideoClip(scene, i, tempDir, title);
      } catch (err: any) {
        console.error(`[VideoGen] Scene ${i + 1} AI video FAILED: ${err.message}`);
        failedScenes.push(i + 1);

        if (err.message.includes("402") || err.message.includes("Payment Required") || err.message.includes("Insufficient credit")) {
          creditError = "Replicate account has insufficient credits. Please add credits at replicate.com/account/billing to generate real AI video clips.";
          return;
        }

        if (err.message.includes("429") || err.message.includes("Too Many Requests") || err.message.includes("rate limit")) {
          console.log(`[VideoGen] Rate limited, waiting 10 seconds before retry...`);
          await new Promise(r => setTimeout(r, 10000));
          try {
            clipResults[i] = await generateAIVideoClip(scene, i, tempDir, title);
            const idx = failedScenes.indexOf(i + 1);
            if (idx >= 0) failedScenes.splice(idx, 1);
          } catch (retryErr: any) {
            console.error(`[VideoGen] Scene ${i + 1} retry also failed: ${retryErr.message}`);
          }
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, scenes.length) }, () => processClip());
  await Promise.all(workers);

  if (creditError) {
    for (const clip of clipResults) {
      if (clip) try { fs.unlinkSync(clip); } catch {}
    }
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    throw new Error(creditError);
  }

  const clipPaths = clipResults.filter((c): c is string => c !== null);

  if (clipPaths.length === 0) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    throw new Error(`All AI video clip generation failed. No slideshow fallback. Failed scenes: ${failedScenes.join(", ")}`);
  }

  if (failedScenes.length > 0) {
    console.warn(`[VideoGen] WARNING: ${failedScenes.length} scene(s) failed (${failedScenes.join(", ")}), stitching ${clipPaths.length} successful clips`);
  }

  let narrationPaths: string[] | undefined;
  if (narration?.enabled && narration.voice) {
    console.log(`[VideoGen] Generating narration with voice: ${narration.voice}`);
    const captions = scenes
      .filter((_, i) => !failedScenes.includes(i + 1))
      .map(s => s.caption);
    narrationPaths = await generateNarrationAudio(captions, narration.voice, tempDir);
  }

  try {
    await stitchClipsWithTransitions(clipPaths, outputPath, narrationPaths);
  } catch (err) {
    // Don't leave a half-written movie behind.
    try { fs.unlinkSync(outputPath); } catch {}
    throw err;
  } finally {
    // Always remove the downloaded clips and narration - they are large.
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error("Final video file was not created");
  }

  const finalSize = fs.statSync(outputPath).size;
  const finalDuration = await probeClipDuration(outputPath);
  console.log(`[VideoGen] REAL AI VIDEO created: ${outputPath} (${finalDuration.toFixed(1)}s, ${(finalSize / 1024 / 1024).toFixed(1)}MB, ${clipPaths.length} scenes${narration?.enabled ? ', with narration' : ''})`);

  return `/videos/${outputFilename}`;
}
