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
}

interface NarrationConfig {
  enabled: boolean;
  voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  voiceSampleUrl?: string | null;
}

function getPublicImageUrl(imagePath: string): string {
  const relativePath = imagePath.replace(path.join(process.cwd(), "client", "public"), "");
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) {
    return `https://${devDomain}${relativePath}`;
  }
  const slug = process.env.REPL_SLUG;
  const owner = process.env.REPL_OWNER;
  if (slug && owner) {
    return `https://${slug}.${owner}.repl.co${relativePath}`;
  }
  return `http://localhost:5000${relativePath}`;
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

const MOTION_DESCRIPTORS = [
  "The subject walks forward slowly while turning their head, gesturing with their hands. Camera slowly pushes in (dolly forward). Background has gentle wind moving leaves and grass, light flickers through trees, distant figures walk past.",
  "The subject turns to look at something, shifting their weight and reaching out. Camera pans smoothly left to right following their gaze. Background shows parallax motion — close objects move faster than distant ones, wind blows through hair and clothes.",
  "The subject leans forward with emotion, making expressive hand gestures. Camera tilts upward slowly while pulling back. Background has flowing water, swaying branches, clouds drifting, and ambient motion everywhere.",
  "The subject walks away then pauses and turns back with a gentle smile. Camera dollies sideways in a tracking shot. Background has flickering warm light, floating dust particles, and subtle environmental motion throughout.",
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

  const motionDesc = MOTION_DESCRIPTORS[sceneIndex % MOTION_DESCRIPTORS.length];

  const prompt = `REAL VIDEO CLIP with continuous motion every second. ${scene.caption}. ${motionDesc}. Subject movement: person walks, turns, gestures naturally. Camera movement: slow cinematic dolly/pan/push-in throughout. Environmental motion: wind in trees/hair/clothes, flowing water, drifting particles, flickering light, parallax depth. No frozen frames. No still images. Cinematic warm nostalgic tone. Stable coherent scene with natural lifelike motion throughout entire clip.`;

  const remoteVideoUrl = await animateImageToVideo(publicUrl, prompt, "16:9");

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

async function stitchClipsWithTransitions(
  clipPaths: string[],
  outputPath: string,
  narrationPaths?: string[]
): Promise<void> {
  if (clipPaths.length === 0) throw new Error("No clips to stitch");

  const hasNarration = narrationPaths && narrationPaths.some(p => p !== "");

  if (clipPaths.length === 1 && !hasNarration) {
    const cmd = `ffmpeg -y -i "${clipPaths[0]}" -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -movflags +faststart -an "${outputPath}" 2>&1`;
    await execAsync(cmd, { timeout: 60000 });
    return;
  }

  const durations: number[] = [];
  for (const clip of clipPaths) {
    const dur = await probeClipDuration(clip);
    durations.push(dur);
  }

  if (clipPaths.length === 1 && hasNarration) {
    const narrationPath = narrationPaths![0] || "";
    if (narrationPath) {
      const cmd = `ffmpeg -y -i "${clipPaths[0]}" -i "${narrationPath}" -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 128k -shortest "${outputPath}" 2>&1`;
      await execAsync(cmd, { timeout: 60000 });
    } else {
      const cmd = `ffmpeg -y -i "${clipPaths[0]}" -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -movflags +faststart -an "${outputPath}" 2>&1`;
      await execAsync(cmd, { timeout: 60000 });
    }
    return;
  }

  const inputs = clipPaths.map((p) => `-i "${p}"`).join(" ");
  const filterParts: string[] = [];

  for (let i = 0; i < clipPaths.length; i++) {
    filterParts.push(
      `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,` +
      `setpts=PTS-STARTPTS,fps=24[v${i}]`
    );
  }

  const minClipDuration = Math.min(...durations);
  const transitionDuration = Math.min(1.0, minClipDuration * 0.4);
  let lastLabel = "v0";
  const xfadeChain: string[] = [];
  let cumulativeOffset = 0;

  for (let i = 1; i < clipPaths.length; i++) {
    const prevDuration = durations[i - 1];
    const effectiveTransition = Math.min(transitionDuration, prevDuration * 0.4);
    cumulativeOffset += prevDuration - effectiveTransition;
    const transitions = ["fade", "dissolve", "smoothleft", "circlecrop", "fadeblack"];
    const transition = transitions[i % transitions.length];
    const outLabel = i < clipPaths.length - 1 ? `xf${i}` : "outv";
    xfadeChain.push(
      `[${lastLabel}][v${i}]xfade=transition=${transition}:duration=${effectiveTransition.toFixed(2)}:offset=${cumulativeOffset.toFixed(2)}[${outLabel}]`
    );
    lastLabel = outLabel;
  }

  const fullVideoFilter = filterParts.join(";") + ";" + xfadeChain.join(";");

  if (!hasNarration) {
    const cmd = `ffmpeg -y ${inputs} -filter_complex "${fullVideoFilter}" -map "[outv]" -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -movflags +faststart -an "${outputPath}" 2>&1`;
    console.log("[VideoGen] Stitching AI video clips with cinematic transitions (no narration)...");
    try {
      await execAsync(cmd, { timeout: 180000 });
    } catch (error: any) {
      console.error("FFmpeg stitch error:", error.stderr?.substring(0, 1000) || error.message);
      throw new Error("Video stitching failed");
    }
    return;
  }

  console.log("[VideoGen] Stitching video with narration audio...");

  const videoOnlyPath = outputPath.replace(".mp4", "-videoonly.mp4");
  const videoCmd = `ffmpeg -y ${inputs} -filter_complex "${fullVideoFilter}" -map "[outv]" -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -movflags +faststart -an "${videoOnlyPath}" 2>&1`;

  try {
    await execAsync(videoCmd, { timeout: 180000 });
  } catch (error: any) {
    console.error("FFmpeg video stitch error:", error.stderr?.substring(0, 1000) || error.message);
    throw new Error("Video stitching failed");
  }

  const validNarrations = narrationPaths!.filter(p => p !== "");
  if (validNarrations.length === 0) {
    fs.renameSync(videoOnlyPath, outputPath);
    return;
  }

  const narrationConcatPath = path.join(path.dirname(outputPath), `narration-concat-${Date.now()}.wav`);

  if (validNarrations.length === 1) {
    fs.copyFileSync(validNarrations[0], narrationConcatPath);
  } else {
    const narrationDurations: number[] = [];
    for (const np of narrationPaths!) {
      if (np) {
        narrationDurations.push(await probeClipDuration(np));
      } else {
        narrationDurations.push(0);
      }
    }

    const concatListPath = path.join(path.dirname(outputPath), `narration-list-${Date.now()}.txt`);
    const silencePath = path.join(path.dirname(outputPath), `silence-${Date.now()}.wav`);

    let concatContent = "";
    let accumulatedVideoTime = 0;
    let accumulatedAudioTime = 0;

    for (let i = 0; i < narrationPaths!.length; i++) {
      const videoDur = i < durations.length ? durations[i] : 5;
      const narPath = narrationPaths![i];

      if (narPath) {
        const gap = accumulatedVideoTime - accumulatedAudioTime;
        if (gap > 0.5) {
          const gapSilencePath = path.join(path.dirname(outputPath), `gap-silence-${i}-${Date.now()}.wav`);
          await execAsync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${gap.toFixed(2)} "${gapSilencePath}" 2>&1`, { timeout: 10000 });
          concatContent += `file '${gapSilencePath}'\n`;
          accumulatedAudioTime += gap;
        }

        concatContent += `file '${narPath}'\n`;
        accumulatedAudioTime += narrationDurations[i];
      }

      accumulatedVideoTime += videoDur;
      if (i < durations.length - 1) {
        accumulatedVideoTime -= Math.min(transitionDuration, videoDur * 0.4);
      }
    }

    fs.writeFileSync(concatListPath, concatContent);
    try {
      await execAsync(`ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c:a pcm_s16le "${narrationConcatPath}" 2>&1`, { timeout: 30000 });
    } catch (err: any) {
      console.error("[VideoGen] Narration concat failed:", err.message);
      fs.renameSync(videoOnlyPath, outputPath);
      try { fs.unlinkSync(concatListPath); } catch {}
      return;
    }
    try { fs.unlinkSync(concatListPath); } catch {}
    try { fs.unlinkSync(silencePath); } catch {}
  }

  try {
    const mergeCmd = `ffmpeg -y -i "${videoOnlyPath}" -i "${narrationConcatPath}" -c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart "${outputPath}" 2>&1`;
    await execAsync(mergeCmd, { timeout: 60000 });
    console.log("[VideoGen] Narration audio merged into video successfully");
  } catch (err: any) {
    console.error("[VideoGen] Audio merge failed, using video without narration:", err.message);
    fs.renameSync(videoOnlyPath, outputPath);
  }

  try { fs.unlinkSync(videoOnlyPath); } catch {}
  try { fs.unlinkSync(narrationConcatPath); } catch {}
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

  const outputDir = path.join(process.cwd(), "client", "public", "videos");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

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

  await stitchClipsWithTransitions(clipPaths, outputPath, narrationPaths);

  for (const clip of clipPaths) {
    try { fs.unlinkSync(clip); } catch {}
  }
  if (narrationPaths) {
    for (const np of narrationPaths) {
      if (np) try { fs.unlinkSync(np); } catch {}
    }
  }
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}

  if (!fs.existsSync(outputPath)) {
    throw new Error("Final video file was not created");
  }

  const finalSize = fs.statSync(outputPath).size;
  const finalDuration = await probeClipDuration(outputPath);
  console.log(`[VideoGen] REAL AI VIDEO created: ${outputPath} (${finalDuration.toFixed(1)}s, ${(finalSize / 1024 / 1024).toFixed(1)}MB, ${clipPaths.length} scenes${narration?.enabled ? ', with narration' : ''})`);

  return `/videos/${outputFilename}`;
}
