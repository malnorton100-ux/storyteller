import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertStorySchema } from "@shared/schema";
import { openai, ensureCompatibleFormat, speechToText, textToSpeech } from "./replit_integrations/audio/client";
import { generateImageBuffer, generateImageWithReference } from "./replit_integrations/image/client";
import { generateVideoFromScenes, generatePreviewMovie, cleanUpVideoLeftovers } from "./video-generator";
import { sendEmail, movieReadyEmail, movieFailedEmail } from "./email";
import { isLumaConfigured, setReplicateToken, validateAndFixToken } from "./luma-client";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { userId, userOwnsStory, isOwner } from "./auth";
import { VOICE_DIR, voiceSampleUrlFor, voiceSamplePath, moveVoiceSamplesPrivate } from "./voice-samples";
import { ensurePaywallSchema, claimPictureRun, claimMovieRun, getAllowance, mayPaintCover, dailyTextAiLimit } from "./paywall";
import { PUBLIC_DATA_DIR, TEXT_MODEL, parseAiJson } from "./config";
import express from "express";
import crypto from "crypto";
import fs from "fs";
import { execFileSync } from "child_process";
import path from "path";

const illustrationJobs = new Map<string, { status: "generating" | "complete" | "failed" | "cancelled"; totalScenes: number; completedScenes: number; storyId: number; cancelled?: boolean; error?: string }>();
const cancelledVideoIds = new Set<number>();

async function parallelBatch<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = 2
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (err) {
        results[idx] = null;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

async function generateCoverForStory(storyId: number, title: string, content: string) {
  const illustrations = await storage.getIllustrations(storyId);
  if (illustrations.length > 0) {
    const cover = illustrations.find(i => i.sceneOrder === 1) || illustrations[0];
    await storage.updateStory(storyId, { coverImageUrl: cover.imageUrl });
    console.log(`Cover set from existing illustration for story ${storyId}: ${cover.imageUrl}`);
    return;
  }

  const snippet = content.substring(0, 300);
  const prompt = `A warm, nostalgic watercolor-style book cover illustration for a personal memoir story titled "${title}". The scene depicts: ${snippet}. Style: gentle watercolor painting with soft warm golden tones, sepia undertones, storybook quality, inviting and emotional. No text or words in the image.`;

  const imageBuffer = await generateImageBuffer(prompt, "1024x1024");
  const coverDir = path.join(PUBLIC_DATA_DIR, "images", "covers");
  if (!fs.existsSync(coverDir)) fs.mkdirSync(coverDir, { recursive: true });
  const filename = `cover-${storyId}-${Date.now()}.png`;
  const imagePath = path.join(coverDir, filename);
  fs.writeFileSync(imagePath, imageBuffer);

  const coverUrl = `/images/covers/${filename}`;
  await storage.updateStory(storyId, { coverImageUrl: coverUrl });
  console.log(`Cover generated for story ${storyId}: ${coverUrl}`);
}


/** Turn an AI/server error into a plain-English reason the app can show. */
function friendlyAiError(error: any): string {
  const status = error?.status || error?.response?.status;
  const code = error?.code || error?.error?.code || "";
  const msg = String(error?.message || error || "");
  if (status === 401 || /api key|incorrect api key|missing-openai-key/i.test(msg)) return "The OpenAI key isn't working. Check OPENAI_API_KEY in Railway.";
  if (code === "insufficient_quota" || /quota|billing|credit/i.test(msg)) return "The OpenAI account is out of credit. Top it up at platform.openai.com → Billing.";
  if (status === 429) return "OpenAI is busy right now. Please try again in a minute.";
  if (code === "content_policy_violation" || /safety|content policy|moderation|rejected/i.test(msg)) return "The AI wouldn't make pictures for this story as written. Try the G rating, or change any details it might find unsuitable.";
  if (status === 404 || /model .*does not exist|not found/i.test(msg)) return `The AI model isn't available: ${msg.slice(0, 160)}`;
  return `Something went wrong: ${msg.slice(0, 200)}`;
}


/**
 * One exact outfit for the storyteller, used on every page so they look the same.
 * For a child it must be modest and age-appropriate; anything else is swapped for
 * a fixed modest outfit that suits the setting.
 */
function storytellerOutfitFor(isChild: boolean, aiOutfit: string, storyText: string): string {
  const outfit = (aiOutfit || "").trim();
  if (!isChild) return outfit;
  const unsuitable = /g-?string|thong|bikini|speedo|budgie|underwear|undies|briefs|topless|shirtless|bare[- ]chest|naked|nude|swimsuit|swimmers|cossie|togs|trunks/i;
  if (outfit && !unsuitable.test(outfit)) return `${outfit} (modest, age-appropriate)`;
  const watery = /beach|surf|swim|ocean|sea|wave|pool|river|creek|lake|break ?wall|rock ?pool/i.test(storyText);
  return watery
    ? "a plain navy long-sleeve rash vest and red knee-length boardshorts"
    : "a plain navy T-shirt and khaki knee-length shorts";
}

/** One clear line about glasses so they don't come and go between pages. */
function glassesLine(info: any): string {
  return String(info?.storyteller?.glasses || "").toLowerCase().startsWith("y")
    ? "Wears the same glasses in every picture."
    : "Does NOT wear glasses in any picture.";
}

/** A movie that takes longer than this is marked failed (and the user emailed) instead of spinning forever. */
const MOVIE_TIME_LIMIT_MS = Number(process.env.MOVIE_TIME_LIMIT_MINUTES || 25) * 60 * 1000;
function withTimeLimit<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Movie took longer than ${Math.round(ms / 60000)} minutes - stopped`)), ms);
    work.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(express.json({ limit: "50mb" }));
  await ensurePaywallSchema();
  await moveVoiceSamplesPrivate();
  // Brake on the cheap AI helpers so one account can't hammer them all day.
  app.use(["/api/transcribe", "/api/enhance-story", "/api/story-helper", "/api/suggest-title", "/api/preview-voice"], dailyTextAiLimit);
  try { cleanUpVideoLeftovers(); } catch (e) { console.warn("[VideoGen] Cleanup skipped:", (e as Error).message); }
  storage.failInterruptedVideos()
    .then((n) => { if (n) console.log(`[VideoGen] Marked ${n} interrupted movie(s) as failed so they can be retried`); })
    .catch((e) => console.warn("[VideoGen] Could not check for interrupted movies:", e?.message));

  app.get("/api/stories", async (req, res) => {
    try {
      const stories = await storage.getStories(userId(req));
      res.json(stories);
    } catch (error) {
      console.error("Error fetching stories:", error);
      res.status(500).json({ error: "Failed to fetch stories" });
    }
  });

  app.get("/api/stories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const story = await storage.getStory(id);
      if (!story) return res.status(404).json({ error: "Story not found" });
      const illustrationsList = await storage.getIllustrations(id);
      res.json({ ...story, illustrations: illustrationsList });
    } catch (error) {
      console.error("Error fetching story:", error);
      res.status(500).json({ error: "Failed to fetch story" });
    }
  });

  app.post("/api/stories", async (req, res) => {
    try {
      const parsed = insertStorySchema.parse(req.body);
      const story = await storage.createStory({ ...parsed, userId: userId(req), shareToken: null });
      // No AI cover here (it cost a picture for every story, paid or not):
      // the first storybook picture becomes the cover.
      res.status(201).json(story);
    } catch (error) {
      console.error("Error creating story:", error);
      res.status(400).json({ error: "Failed to create story" });
    }
  });

  app.patch("/api/stories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validRatings = ["G", "PG", "M"];
      if (req.body.contentRating && !validRatings.includes(req.body.contentRating)) {
        return res.status(400).json({ error: "Invalid content rating. Must be G, PG, or M." });
      }
      const allowed = ["title", "content", "era", "category", "contentRating", "coverImageUrl", "audioTranscript"];
      const updates: Record<string, any> = {};
      for (const key of allowed) {
        if (key in req.body) updates[key] = req.body[key];
      }
      const story = await storage.updateStory(id, updates);
      if (!story) return res.status(404).json({ error: "Story not found" });
      res.json(story);
    } catch (error) {
      console.error("Error updating story:", error);
      res.status(400).json({ error: "Failed to update story" });
    }
  });

  app.post("/api/stories/:id/cover", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const story = await storage.getStory(id);
      if (!story) return res.status(404).json({ error: "Story not found" });

      const hasPictures = (await storage.getIllustrations(id)).length > 0;
      if (!hasPictures && !(await mayPaintCover(req, id))) {
        return res.status(402).json({ error: "Make the storybook pictures first - the first one becomes the cover." });
      }
      await generateCoverForStory(id, story.title, story.content);
      const updated = await storage.getStory(id);
      res.json(updated);
    } catch (error) {
      console.error("Error generating cover:", error);
      res.status(500).json({ error: "Failed to generate cover image" });
    }
  });

  app.post("/api/stories/generate-covers", async (req, res) => {
    try {
      const stories = await storage.getStories(userId(req));
      const needsCover = [];
      for (const s of stories) {
        if (s.coverImageUrl || s.content.length <= 30) continue;
        const hasPictures = (await storage.getIllustrations(s.id)).length > 0;
        if (hasPictures || (await mayPaintCover(req, s.id))) needsCover.push(s);
      }
      res.json({ message: `Generating covers for ${needsCover.length} stories in the background`, count: needsCover.length });

      for (const story of needsCover) {
        try {
          await generateCoverForStory(story.id, story.title, story.content);
        } catch (err) {
          console.error(`Failed to generate cover for story ${story.id}:`, err);
        }
      }
    } catch (error) {
      console.error("Error in batch cover generation:", error);
      res.status(500).json({ error: "Failed to start cover generation" });
    }
  });

  app.delete("/api/stories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteStory(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting story:", error);
      res.status(500).json({ error: "Failed to delete story" });
    }
  });

  app.get("/api/stories/:id/allowance", async (req, res) => {
    try {
      res.json(await getAllowance(req, parseInt(req.params.id)));
    } catch (error) {
      console.error("Error fetching allowance:", error);
      res.status(500).json({ error: "Failed to fetch allowance" });
    }
  });

  app.get("/api/stories/:id/illustrations", async (req, res) => {
    try {
      const storyId = parseInt(req.params.id);
      const illustrationsList = await storage.getIllustrations(storyId);
      res.json(illustrationsList);
    } catch (error) {
      console.error("Error fetching illustrations:", error);
      res.status(500).json({ error: "Failed to fetch illustrations" });
    }
  });

  app.post("/api/stories/:id/illustrations", async (req, res) => {
    let refundPictures: (() => Promise<void>) | null = null;
    let startedJobId: string | null = null;
    try {
      const storyId = parseInt(req.params.id);
      const { style, profileId, sceneCount: rawSceneCount } = req.body;
      let sceneCount = Math.min(Math.max(parseInt(rawSceneCount) || 4, 2), 8);

      const story = await storage.getStory(storyId);
      if (!story) return res.status(404).json({ error: "Story not found" });

      // Who pays: free first storybook (2 pages), otherwise the story must be unlocked.
      const claim = await claimPictureRun(req, storyId);
      if (!claim.ok) return res.status(claim.status).json(claim.body);
      if (claim.maxScenes) sceneCount = Math.min(sceneCount, claim.maxScenes);
      refundPictures = claim.refund;

      // Only one picture job per story at a time (a second tap used to start a second set).
      for (const [, j] of Array.from(illustrationJobs.entries())) {
        if (j.storyId === storyId && j.status === "generating") {
          await refundPictures().catch(() => {});
          refundPictures = null;
          return res.status(409).json({ error: "Pictures are already being painted for this story. They'll appear in a minute or two." });
        }
      }

      // Answer the phone straight away; the planning below can take a minute,
      // and phones gave up waiting (showing "failed") while pictures kept coming.
      const jobId = `ill-${storyId}-${Date.now()}`;
      startedJobId = jobId;
      illustrationJobs.set(jobId, { status: "generating", totalScenes: sceneCount, completedScenes: 0, storyId });
      res.status(202).json({ status: "generating", totalScenes: sceneCount, storyId, jobId });

      let profile: any = null;
      if (profileId) {
        profile = await storage.getStorytellerProfile(profileId);
        if (profile && profile.userId !== userId(req)) profile = null;
      } else {
        const profiles = await storage.getStorytellerProfiles(userId(req));
        if (profiles.length > 0) profile = profiles[0];
      }

      let isChildStory = false;
      let storytellerAgeDesc = "";
      if (story.era) {
        const eraDecade = parseInt(story.era.replace(/s$/, ""));
        if (!isNaN(eraDecade)) {
          const currentDecade = Math.floor(new Date().getFullYear() / 10) * 10;
          const decadesAgo = (currentDecade - eraDecade) / 10;
          if (decadesAgo >= 4) {
            isChildStory = true;
            storytellerAgeDesc = "a young boy/girl aged 8-14";
          } else if (decadesAgo >= 2) {
            storytellerAgeDesc = "a young adult in their 30s";
          } else if (decadesAgo >= 1) {
            storytellerAgeDesc = "a person in their 40s-50s";
          }
        }
      }

      const permanentFeatures = profile?.appearanceDescription ? extractPermanentFeatures(profile.appearanceDescription) : "";

      let appearanceInstruction = "";
      if (profile?.appearanceDescription) {
        if (isChildStory) {
          appearanceInstruction = `REFERENCE PHOTO: The reference image shows the storyteller [STORYTELLER] as a young person. Draw them EXACTLY as they appear in the reference — this IS what they look like in this story. Same face, same features. They are the STAR. Their key features: ${permanentFeatures}. Do NOT apply the reference face to any adult/parent character — adults are different people. `;
        } else {
          appearanceInstruction = `REFERENCE PHOTO: The reference photo shows the STORYTELLER [STORYTELLER]. Apply these features directly to the storyteller character. They are the star. `;
        }
      }

      let styleInstruction = "";
      if (style === "cartoon") {
        styleInstruction = "Create in a fun, colorful cartoon/Pixar animation style with bright vivid colors and exaggerated expressions. Make it child-friendly and appealing. Even in cartoon style, the main character's face and distinguishing features must clearly match the reference photo.";
      } else if (style === "realistic") {
        styleInstruction = "Create in a photorealistic, cinematic style with natural lighting and detailed textures. The main character must look exactly like the person in the reference photo - same face, same features, same build.";
      } else if (style === "era") {
        styleInstruction = `Create in the authentic art style of the ${story.era || "mid-20th century"} era. Use period-appropriate color palettes and details. The main character must clearly resemble the person in the reference photo.`;
      }

      const contentRating = story.contentRating || "G";

      const storyText = story.content.substring(0, 2000);

      const characterAnalysis = await openai.chat.completions.create({
        model: TEXT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a story analyst. Read this FIRST-PERSON story carefully. The person saying "I", "me", "my" is the STORYTELLER.

Your job is to identify:
1. WHO is the storyteller in this story? What is their approximate age during the events? Are they a child, teenager, young adult, middle-aged, or elderly?
2. What other characters appear? (dad, mum, friend, sibling, spouse, etc.)
3. What is the relationship between the storyteller and each other character?
4. What activity/setting are they in? What would they realistically be wearing?

${story.era ? `The story is set in the ${story.era}.` : ""}
${profile?.appearanceDescription ? `The storyteller's CURRENT appearance (from a recent photo): ${profile.appearanceDescription}` : ""}

FOCUS ALL YOUR EFFORT ON DESCRIBING THE STORYTELLER. The storyteller is the star — they must be described in rich detail at the correct age for the story. Other characters are secondary — just note their role (dad, mum, friend, etc.) and approximate age.

Respond in JSON:
{
  "storyteller": {
    "ageInStory": "specific age, e.g. about 10 years old / 17 / mid-20s / 40s",
    "isChild": true/false (true if under 18),
    "description": "DETAILED physical description for their age IN THE STORY. Start with: ethnicity, skin tone, eye color/shape, nose shape, face shape (from their current photo). Then age-adjust everything else: if they were a child, describe a child's body — small, lean, smooth skin, NO tattoos, NO facial hair, NO wrinkles, thick full-colored hair. If young adult, no grey hair, fewer lines, leaner build. Be very specific about what they looked like at that age.",
    "outfit": "one SPECIFIC outfit appropriate for the activity and era — name exact colors and garments, e.g. 'faded blue singlet, tan shorts, brown leather sandals'. If they are a child or teen, it MUST be modest and age-appropriate (e.g. a rash vest and boardshorts for the beach), whatever the story says.",
    "glasses": "yes or no - did they wear glasses AT THIS AGE? Only yes if the story says so, or they are an adult who wears glasses in the photo."
  },
  "otherCharacters": ["dad (adult, 30s)", "friend (same age as storyteller)"],
  "setting": "brief setting/location"
}`
          },
          { role: "user", content: storyText }
        ],
        max_completion_tokens: 4000,
      });

      let charInfo: any = null;
      try {
        const rawChar = characterAnalysis.choices[0]?.message?.content || "{}";
        charInfo = parseAiJson(rawChar);
        console.log("[Illustrations] Character analysis:", JSON.stringify(charInfo, null, 2));
      } catch (e) {
        console.warn("[Illustrations] Character analysis parse failed, using defaults");
      }

      const storytellerDesc = `${charInfo?.storyteller?.description || (isChildStory ? "a young child with same ethnicity and skin tone as reference photo" : "the main character matching the reference photo")} ${glassesLine(charInfo)}`;
      const storytellerAge = charInfo?.storyteller?.ageInStory || (isChildStory ? "about 10 years old" : "");
      const storytellerIsChild = charInfo?.storyteller?.isChild ?? isChildStory;
      // Children are always drawn modestly dressed, whatever the story says they wore.
      const storytellerOutfit = storytellerOutfitFor(storytellerIsChild, charInfo?.storyteller?.outfit || "", storyText);
      const otherCharsSimple = Array.isArray(charInfo?.otherCharacters) ? charInfo.otherCharacters.join(", ") : "";

      const sceneSplitResponse = await openai.chat.completions.create({
        model: TEXT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are turning a personal story into a ${sceneCount}-page illustrated picture book, like a classic children's picture book.

STEP 1 - THE WORDS. Split the story's OWN WORDS into exactly ${sceneCount} pages, in order. Each page's "text" is a contiguous passage copied word-for-word from the story (do not rewrite, add or drop anything). Together the pages contain the whole story. Split at natural moments so each page is ONE clear moment, roughly even in length - no page's text more than about twice as long as another's.
The story's biggest moment (the climax, the funny disaster, the turning point) MUST get its own page and its own picture - never squeeze it onto a page with other events.
A present-day closing page holds ONLY the present-day words (e.g. "It's in my shed now. One day, it'll be in yours."), not earlier events.

STEP 2 - THE PICTURE for each page shows EXACTLY what that page's text describes - the reader looks from the words to the picture and it makes sense. If the text mentions mums with tea towels, show the mums; if it mentions a horse, show the horse; if it mentions a wheel coming off, show the wheel flying away.

MAKE THE BOOK VISUALLY VARIED - every page must look clearly different from the others:
- different main subject: people, places, crowds, animals, close-up details (hands at work, a bouncing wheel, a face), not the same object every page
- a recurring object (e.g. a cart, a car) only appears where the text involves it, and is the main subject on at most a third of the pages
- different shot each page: wide establishing shot, crowd scene, mid shot, close-up of hands or a face, low angle, high angle looking down a street, over-the-shoulder
- different setting or time of day where the story allows
- NO two pages in a row may share the same setting AND the same framing - if two pages happen in the same place, change the shot completely (e.g. wide shot of the whole shed, then a tight close-up of small hands hammering a nail)
- the storyteller appears on most pages, caught mid-action and absorbed in the moment (never posing or looking at the camera), with a named emotion. Other people the text mentions SHOULD appear.
- If the story ends by looking back from the present day (e.g. "it's in my shed now"), make the LAST page a present-day scene of the storyteller as they look TODAY, and set "present": true for it.

For each page also give a short caption (10 words max).
Also describe, ONCE, every object or place that appears on more than one page, in precise visual detail (shape, colour, material, wheels, markings), and reuse that exact description wherever it appears.

${contentRating === "G" ? "Make ALL descriptions fully family-friendly. No violence, gore, injuries, or danger." : ""}
${contentRating === "PG" ? "Keep dramatic tension but soften graphic violence." : ""}
${contentRating === "M" ? "Preserve the story's intensity as-written." : ""}

=== THE STORYTELLER (this is the most important character — get them right) ===

The storyteller [STORYTELLER] is: ${storytellerDesc}.
Age in this story: ${storytellerAge}.
Outfit: ${storytellerOutfit || "appropriate for the activity and era"}.
${storytellerIsChild ? "CHILD RULES: Small body, smooth skin, NO tattoos, NO facial hair, NO wrinkles, NO adult features. Thick full-colored hair." : ""}
${otherCharsSimple ? `Other characters in the story: ${otherCharsSimple}. (These are secondary — just make them look reasonable for their role. Do NOT make them look like the storyteller.)` : ""}

RULES:
1. Write [STORYTELLER] after the storyteller character in every page description where they appear, so the image AI knows who they are.
2. Wherever the storyteller appears, repeat their EXACT physical description: height, build, face shape, skin tone, hair colour/style, and outfit. Copy-paste level consistency.
3. Except on a "present": true page, the storyteller is EXACTLY ${storytellerAge} on every page — their body size and proportions NEVER change. ${storytellerIsChild ? `A ${storytellerAge} child is SMALL — shorter than adults, thin limbs, round face. They do NOT grow taller or more muscular in later scenes.` : ""}
4. Same outfit in every scene: ${storytellerOutfit || "as described above"}.
5. Other characters just need their role mentioned (e.g. "his dad" or "her friend") — don't over-describe them. NEVER describe an adult character with the storyteller's features.
6. Show the people the page's text mentions; keep faces of background figures simple.

Respond in valid JSON format ONLY:
{
  "recurring": "precise description of each object/place that appears in more than one scene, or empty string",
  "scenes": [
  ${Array.from({ length: sceneCount }, () => '{"text": "exact words from the story for this page", "caption": "...", "description": "what the picture shows", "emotion": "...", "camera": "...", "present": false}').join(",\n  ")}
  ]
}`
          },
          { role: "user", content: storyText }
        ],
        max_completion_tokens: sceneCount <= 4 ? 8000 : 12000,
      });

      let scenes: { caption: string; description: string; emotion?: string; camera?: string; text?: string; present?: boolean }[] = [];
      let recurringObjects = "";
      try {
        const rawContent = sceneSplitResponse.choices[0]?.message?.content || "[]";
        const parsed = parseAiJson(rawContent);
        const list = Array.isArray(parsed) ? parsed : parsed?.scenes;
        if (!Array.isArray(list) || list.length === 0) throw new Error("Invalid scenes");
        scenes = list;
        if (!Array.isArray(parsed) && typeof parsed?.recurring === "string") recurringObjects = parsed.recurring.trim();
        if (recurringObjects) console.log(`[Illustrations] Recurring objects: ${recurringObjects.slice(0, 300)}`);
        console.log(`[Illustrations] Requested ${sceneCount} scenes, AI generated ${scenes.length} scenes`);
      } catch (parseErr) {
        console.error(`[Illustrations] Failed to parse scene JSON, using fallback for ${sceneCount} scenes:`, (parseErr as Error).message, "| finish_reason:", sceneSplitResponse.choices[0]?.finish_reason);
      }
      if (scenes.length === 0) {
        const contentLen = story.content.length;
        const fallbackScenes: { caption: string; description: string }[] = [];
        const labels = ["The Beginning", "The Journey", "Building Up", "The Turning Point", "The Key Moment", "The Aftermath", "Reflection", "Looking Back"];
        for (let s = 0; s < sceneCount; s++) {
          const start = Math.floor((contentLen * s) / sceneCount);
          const end = Math.min(start + 300, contentLen);
          fallbackScenes.push({
            caption: labels[s] || `Scene ${s + 1}`,
            description: story.content.substring(start, end),
          });
        }
        scenes = fallbackScenes;
      }

      illustrationJobs.set(jobId, { status: "generating", totalScenes: scenes.length, completedScenes: 0, storyId });

      const profilePhotoPath = profile?.photoUrl ? path.join(PUBLIC_DATA_DIR, profile.photoUrl) : null;
      const illDir = path.join(PUBLIC_DATA_DIR, "images", "illustrations");
      if (!fs.existsSync(illDir)) fs.mkdirSync(illDir, { recursive: true });

      let completedCount = 0;
      let consistencyRefPath: string | null = null;
      let ageTransformedRefPath: string | null = null;

      if (storytellerIsChild && profilePhotoPath && fs.existsSync(profilePhotoPath)) {
        const ageTransformPrompt = `This is a photo of a real person. Generate a portrait of this SAME person but as a ${storytellerAge || "young teenager"}. Keep their EXACT same face — same eyes, same nose, same face shape, same skin tone, same ethnicity. Just make them younger: smooth skin, no wrinkles, full thick ${storytellerDesc.includes("dark") ? "dark" : "natural-colored"} hair, youthful features. Same person, just younger. ${glassesLine(charInfo)} Head and shoulders, three-quarter view, natural relaxed expression, looking slightly away from the camera, neutral background.`;
        console.log(`[Child story] Step 0: Generating age-transformed portrait (${storytellerAge})...`);
        try {
          const ageTransformBuf = await generateImageWithReference(profilePhotoPath, ageTransformPrompt, "1024x1024");
          const ageTransformFn = `age-transform-${storyId}-${Date.now()}.png`;
          const ageTransformPath = path.join(illDir, ageTransformFn);
          fs.writeFileSync(ageTransformPath, ageTransformBuf);
          ageTransformedRefPath = ageTransformPath;
          console.log(`[Child story] Age-transformed portrait generated successfully`);
        } catch (err) {
          console.error("[Child story] Age transform failed, will use original photo:", err);
        }
      }

      const effectiveRefPath = ageTransformedRefPath || profilePhotoPath;

      // Direction added to every picture: candid action, real emotion, varied
      // framing, identical recurring objects. The reference image is for the
      // FACE and OUTFIT only - copying its pose made every picture a stiff portrait.
      const sceneDirection = (sc: { emotion?: string; camera?: string }) =>
        [
          `CANDID MOMENT, like a still from a family film: the storyteller is caught mid-action and absorbed in what is happening - NOT posing, NOT looking at the camera, NOT smiling for a photo.`,
          sc.emotion ? `Their expression clearly shows: ${sc.emotion}.` : `Their face shows a clear, natural emotion that fits the moment.`,
          sc.camera ? `Camera: ${sc.camera}.` : "",
          `Use the reference image ONLY for the person's face, hair and outfit - do NOT copy its pose, framing, expression or camera angle.`,
          recurringObjects ? `These objects must look EXACTLY like this in every picture they appear in: ${recurringObjects}` : "",
        ].filter(Boolean).join(" ");

      if (effectiveRefPath && fs.existsSync(effectiveRefPath)) {
        const scene0 = scenes[0];
        const charGuide = storytellerIsChild
          ? `The reference image shows the storyteller [STORYTELLER] at ${storytellerAge}. Draw them EXACTLY as they appear in the reference — same face, same hair, same build. ${glassesLine(charInfo)} Outfit: ${storytellerOutfit}. They are the STAR — the largest, most prominent figure. Any adult (parent, etc.) is a DIFFERENT person who must NOT resemble the reference.`
          : `THE STORYTELLER [STORYTELLER]: ${storytellerDesc}. Age: ${storytellerAge}. Outfit: ${storytellerOutfit}. Apply the reference photo to THIS character. They are the STAR — make them the focal point.`;
        const childNote = storytellerIsChild ? `The storyteller is ${storytellerAge} — draw them as a child/teen exactly matching the reference portrait. ` : "";
        const prompt0 = `Illustrate this personal memory scene: "${scene0.description}". ${sceneDirection(scene0)} ${charGuide} ${childNote}${appearanceInstruction}${styleInstruction} No text or words in the image. Make it warm, emotional, and nostalgic.`;

        try {
          const buf0 = await generateImageWithReference(effectiveRefPath, prompt0, "1024x1024");
          const fn0 = `illustration-${storyId}-scene1-${Date.now()}.png`;
          const fp0 = path.join(illDir, fn0);
          fs.writeFileSync(fp0, buf0);
          consistencyRefPath = fp0;

          await storage.createIllustration({
            storyId,
            imageUrl: `/images/illustrations/${fn0}`,
            style,
            prompt: prompt0,
            sceneCaption: scene0.caption,
            pageText: scene0.text || null,
            sceneOrder: 1,
          });
          completedCount++;
          illustrationJobs.set(jobId, { status: "generating", totalScenes: scenes.length, completedScenes: completedCount, storyId });
          console.log(`Scene 1 generated with ${ageTransformedRefPath ? "age-transformed" : "original"} reference (child=${storytellerIsChild})`);
        } catch (err) {
          console.error("Failed to generate scene 1 with reference:", err);
        }
      }

      const remainingScenes = consistencyRefPath ? scenes.slice(1) : scenes;

      const results = await parallelBatch(remainingScenes, async (scene, idx) => {
        const job = illustrationJobs.get(jobId);
        if (job?.cancelled) throw new Error("Job cancelled");

        const i = consistencyRefPath ? idx + 1 : idx;
        const isPresent = scene.present === true && !!profilePhotoPath && fs.existsSync(profilePhotoPath);
        const sceneCharGuide = isPresent
          ? `PRESENT DAY: this page shows the storyteller [STORYTELLER] as they look TODAY - match the person in the reference photo exactly, at their real current age. Not a child.`
          : storytellerIsChild
          ? `The reference image shows the storyteller [STORYTELLER] as a child/teen. Match them EXACTLY — same face, same hair, same body size, same outfit (${storytellerOutfit}). ${glassesLine(charInfo)} Age: ${storytellerAge}. They must look identical across all scenes. Any adults are DIFFERENT people.`
          : `THE STORYTELLER [STORYTELLER]: ${storytellerDesc}. Age: ${storytellerAge}. Outfit: ${storytellerOutfit}. Must look IDENTICAL to the person in the reference image. They are the STAR.`;
        const prompt = `Illustrate this personal memory scene: "${scene.description}". ${sceneDirection(scene)} ${sceneCharGuide} ${appearanceInstruction}${styleInstruction} No text or words in the image. Make it warm, emotional, and nostalgic.`;

        let imageBuffer: Buffer;
        if (consistencyRefPath && fs.existsSync(consistencyRefPath)) {
          try {
            // Face from the portrait, outfit/objects/style from page 1 - so pages
            // don't all inherit page 1's pose.
            imageBuffer = isPresent
              ? await generateImageWithReference(profilePhotoPath!, prompt, "1024x1024", consistencyRefPath)
              : effectiveRefPath && fs.existsSync(effectiveRefPath)
              ? await generateImageWithReference(effectiveRefPath, prompt, "1024x1024", consistencyRefPath)
              : await generateImageWithReference(consistencyRefPath, prompt, "1024x1024");
          } catch {
            imageBuffer = await generateImageBuffer(prompt, "1024x1024");
          }
        } else {
          imageBuffer = await generateImageBuffer(prompt, "1024x1024");
        }

        const jobCheck = illustrationJobs.get(jobId);
        if (jobCheck?.cancelled) throw new Error("Job cancelled");

        const filename = `illustration-${storyId}-scene${i + 1}-${Date.now()}.png`;
        const imagePath = path.join(illDir, filename);
        fs.writeFileSync(imagePath, imageBuffer);

        await storage.createIllustration({
          storyId,
          imageUrl: `/images/illustrations/${filename}`,
          style,
          prompt,
          sceneCaption: scene.caption,
          pageText: scene.text || null,
          sceneOrder: i + 1,
        });
        completedCount++;
        illustrationJobs.set(jobId, { ...illustrationJobs.get(jobId)!, status: "generating", completedScenes: completedCount });
        return true;
      }, 3);

      completedCount = (consistencyRefPath ? 1 : 0) + results.filter(r => r !== null).length;

      const finalJob = illustrationJobs.get(jobId);
      const wasCancelled = finalJob?.cancelled;
      illustrationJobs.set(jobId, { status: wasCancelled ? "cancelled" : (completedCount > 0 ? "complete" : "failed"), totalScenes: scenes.length, completedScenes: completedCount, storyId, cancelled: wasCancelled, error: !wasCancelled && completedCount === 0 ? "The AI couldn't paint these pictures. Try the G rating, or change any details it might find unsuitable." : undefined });
      setTimeout(() => illustrationJobs.delete(jobId), 300000);

      // Nothing came out: give the go back.
      if (completedCount === 0 && refundPictures) await refundPictures().catch(() => {});

      if (completedCount > 0) {
        const allIllustrations = await storage.getIllustrations(storyId);
        const firstScene = allIllustrations.find(i => i.sceneOrder === 1) || allIllustrations[0];
        if (firstScene) {
          await storage.updateStory(storyId, { coverImageUrl: firstScene.imageUrl });
          console.log(`Cover updated from illustration for story ${storyId}`);
        }
      }
    } catch (error) {
      console.error("Error generating illustrations:", error);
      if (refundPictures) await refundPictures().catch(() => {});
      if (startedJobId) {
        const j = illustrationJobs.get(startedJobId);
        if (j) {
          illustrationJobs.set(startedJobId, { ...j, status: "failed", error: friendlyAiError(error) });
          setTimeout(() => illustrationJobs.delete(startedJobId!), 300000);
        }
      }
      if (!res.headersSent) {
        res.status(500).json({ error: friendlyAiError(error) });
      }
    }
  });

  app.get("/api/illustration-jobs/:jobId", async (req, res) => {
    const job = illustrationJobs.get(req.params.jobId);
    if (!job) return res.json({ status: "complete", totalScenes: 0, completedScenes: 0 });
    if (!(await userOwnsStory(req, job.storyId))) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  });

  app.post("/api/illustration-jobs/:jobId/cancel", async (req, res) => {
    const job = illustrationJobs.get(req.params.jobId);
    if (!job || !(await userOwnsStory(req, job.storyId))) return res.status(404).json({ error: "Job not found" });
    job.cancelled = true;
    job.status = "cancelled";
    illustrationJobs.set(req.params.jobId, job);
    console.log(`[IllustrationJob] Job ${req.params.jobId} cancelled by user`);
    res.json({ status: "cancelled" });
  });

  app.patch("/api/illustrations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { customText } = req.body;
      const updated = await storage.updateIllustration(id, { customText: customText ?? null });
      if (!updated) return res.status(404).json({ error: "Illustration not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating illustration:", error);
      res.status(500).json({ error: "Failed to update illustration" });
    }
  });

  app.delete("/api/illustrations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteIllustration(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting illustration:", error);
      res.status(500).json({ error: "Failed to delete illustration" });
    }
  });

  app.post("/api/transcribe", async (req, res) => {
    try {
      const { audio } = req.body;
      if (!audio) return res.status(400).json({ error: "Audio data required" });

      const rawBuffer = Buffer.from(audio, "base64");
      const { buffer: audioBuffer, format } = await ensureCompatibleFormat(rawBuffer);
      const transcript = await speechToText(audioBuffer, format);

      res.json({ transcript });
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    }
  });

  app.post("/api/enhance-story", async (req, res) => {
    try {
      const { content } = req.body;
      if (!content) return res.status(400).json({ error: "Content required" });

      const response = await openai.chat.completions.create({
        model: TEXT_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a warm, empathetic storyteller who helps grandparents and aunties polish their life stories. Take the raw text (which may be a voice transcript) and gently refine it into a beautiful, readable narrative while preserving the original voice and personality. Keep the first-person perspective. Fix grammar and flow but maintain the authentic feel. Add paragraph breaks where appropriate. Do NOT add anything that wasn't in the original story."
          },
          {
            role: "user",
            content: `Please polish this story while keeping its authentic voice:\n\n${content}`
          }
        ],
        max_completion_tokens: 6000,
      });

      const enhanced = response.choices[0]?.message?.content || content;
      res.json({ enhanced });
    } catch (error) {
      console.error("Error enhancing story:", error);
      res.status(500).json({ error: "Failed to enhance story" });
    }
  });

  // ── Story Helper ───────────────────────────────────────────────────────
  // Step 1: read the raw story and ask a few warm follow-up questions that pull out
  // the details the pictures and movie need (who, when, where, what things looked like).
  app.post("/api/story-helper/questions", async (req, res) => {
    try {
      const { content, era, category } = req.body || {};
      if (!content || String(content).trim().length < 20) {
        return res.status(400).json({ error: "Tell us a little more of your story first" });
      }

      const response = await openai.chat.completions.create({
        model: TEXT_MODEL,
        messages: [
          {
            role: "system",
            content: `You help older people (grandparents, aunties, uncles) turn a memory into a beautiful illustrated storybook and a short movie for their family.

Read their story and ask 3 to 5 short, warm follow-up questions - the kind a curious grandchild would ask. Pick the questions that will most improve the story AND the pictures. Prioritise what is missing:
- How old they were and roughly what year it was (only if not already clear)
- Where exactly it happened and what the place looked, sounded and smelled like
- Who else was there, and one detail about each person (what they wore, a habit, something they said)
- What any important object looked like (e.g. the car, the bike, the fishing rod: colour, size, material)
- What they were wearing
- How they felt at the key moment, and what they remember most vividly
- How it ended, or what it meant to them looking back

Rules:
- Never ask about something the story already answers.
- One idea per question, under 20 words, plain friendly language. Write in the same language and spelling style the storyteller uses.
- Give each question a short example answer hint to make it easy (e.g. "e.g. a long bamboo rod with a red reel").

Respond in valid JSON ONLY:
{"questions": [{"question": "...", "hint": "e.g. ..."}]}`,
          },
          {
            role: "user",
            content: `${era ? `Era: ${era}\n` : ""}${category ? `Type of memory: ${category}\n` : ""}Story:\n${String(content).slice(0, 12000)}`,
          },
        ],
        max_completion_tokens: 3000,
      });

      let questions: { question: string; hint?: string }[] = [];
      try {
        const parsed = parseAiJson(response.choices[0]?.message?.content || "{}");
        const list = Array.isArray(parsed) ? parsed : parsed?.questions;
        if (Array.isArray(list)) {
          questions = list
            .filter((q: any) => q && typeof q.question === "string" && q.question.trim())
            .slice(0, 5)
            .map((q: any) => ({ question: q.question.trim(), hint: typeof q.hint === "string" ? q.hint.trim() : undefined }));
        }
      } catch (err) {
        console.error("[StoryHelper] Could not parse questions:", (err as Error).message);
      }
      if (questions.length === 0) {
        questions = [
          { question: "How old were you, and roughly what year was it?", hint: "e.g. about 8, around 1965" },
          { question: "Where were you, and what did it look like?", hint: "e.g. a sandy riverbank under tall trees" },
          { question: "Who else was there?", hint: "e.g. Dad in his old blue work shirt, and my brother Pete" },
          { question: "What do you remember most about that moment?", hint: "e.g. the smell of the campfire" },
        ];
      }
      res.json({ questions });
    } catch (error) {
      console.error("Error generating story questions:", error);
      res.status(500).json({ error: "Failed to get questions" });
    }
  });

  // Step 2: weave the answers into a vivid, picture-ready story in the storyteller's own voice.
  app.post("/api/story-helper/write", async (req, res) => {
    try {
      const { content, era, category, answers } = req.body || {};
      if (!content) return res.status(400).json({ error: "Content required" });

      const qa = Array.isArray(answers)
        ? answers
            .filter((a: any) => a && typeof a.answer === "string" && a.answer.trim())
            .map((a: any) => `Q: ${String(a.question || "").slice(0, 300)}\nA: ${String(a.answer).slice(0, 2000)}`)
            .join("\n\n")
        : "";

      const response = await openai.chat.completions.create({
        model: TEXT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a gifted storyteller and ghost-writer. You help older people turn a real memory into the best possible version of their own story. It will be read aloud to their grandchildren and turned into an illustrated storybook and a short movie.

Write the story so that it:
- Stays TRUE. Use only the events, people and facts the storyteller gave (in the story and in their answers). Never invent new events, new people, names, or facts about real family members.
- Sounds like THEM. First person, their voice, their sayings, slang and regional expressions, wherever they are from. Write in the same language and spelling style they used. Warm, simple language a 7-year-old can follow and an adult enjoys.
- Is VIVID and CINEMATIC. Open with a strong scene that drops us into the moment. Show, don't tell. Bring in the sights, sounds, smells and weather they described, plus gentle period-authentic atmosphere for the era and place (only small sensory touches, never new plot).
- Is easy to ILLUSTRATE. Make clear where each moment happens and who is there. Describe each important object ONCE in clear visual detail (colour, size, material) and then always call it the same thing, so it looks the same in every picture. Keep their age and clothing consistent.
- Has a clear shape: a beginning that sets the scene, a middle with the key moment, and an ending that lands, ideally with a line of what it meant to them or what they'd want the grandkids to know.
- Is 250 to 600 words, in short paragraphs (each paragraph roughly one picture). No headings, no title, no bullet points.

Return ONLY the finished story text.`,
          },
          {
            role: "user",
            content: `${era ? `Era: ${era}\n` : ""}${category ? `Type of memory: ${category}\n` : ""}Their story:\n${String(content).slice(0, 12000)}${qa ? `\n\nTheir answers to follow-up questions:\n${qa}` : ""}`,
          },
        ],
        max_completion_tokens: 6000,
      });

      const story = response.choices[0]?.message?.content?.trim();
      if (!story) return res.status(500).json({ error: "Failed to write story" });
      res.json({ story });
    } catch (error) {
      console.error("Error writing story:", error);
      res.status(500).json({ error: "Failed to write story" });
    }
  });

  app.get("/api/video-config", (_req, res) => {
    res.json({
      aiVideoEnabled: isLumaConfigured(),
      mode: isLumaConfigured() ? "ai-video" : "ken-burns",
    });
  });

  app.post("/api/set-replicate-token", async (req, res) => {
    // Changing the server's video API key is for the app owner only.
    const me = await storage.getUser(userId(req));
    const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase();
    if (!adminEmail || me?.username !== adminEmail) {
      return res.status(403).json({ error: "Only the app owner can change this setting" });
    }
    const { token } = req.body;
    if (!token || !token.startsWith("r8_")) {
      return res.status(400).json({ error: "Invalid token format" });
    }
    setReplicateToken(token.trim());
    res.json({ success: true, configured: isLumaConfigured() });
  });

  app.get("/api/stories/:id/videos", async (req, res) => {
    try {
      const storyId = parseInt(req.params.id);
      const videos = await storage.getStoryVideos(storyId);
      res.json(videos);
    } catch (error) {
      console.error("Error fetching videos:", error);
      res.status(500).json({ error: "Failed to fetch videos" });
    }
  });

  app.post("/api/stories/:id/videos", async (req, res) => {
    let refundMovie: (() => Promise<void>) | null = null;
    try {
      const storyId = parseInt(req.params.id);
      const { style, profileId, enableNarration } = req.body;

      const story = await storage.getStory(storyId);
      if (!story) return res.status(404).json({ error: "Story not found" });

      // The movie is the expensive part: it must be paid for first.
      const movieClaim = await claimMovieRun(req, storyId);
      if (!movieClaim.ok) return res.status(movieClaim.status).json(movieClaim.body);
      refundMovie = movieClaim.refund;

      let videoIsChildStory = false;
      let videoStorytellerAgeDesc = "";
      if (story.era) {
        const eraDecade = parseInt(story.era.replace(/s$/, ""));
        if (!isNaN(eraDecade)) {
          const currentDecade = Math.floor(new Date().getFullYear() / 10) * 10;
          const decadesAgo = (currentDecade - eraDecade) / 10;
          if (decadesAgo >= 4) {
            videoIsChildStory = true;
            videoStorytellerAgeDesc = "a young boy/girl aged 8-14";
          } else if (decadesAgo >= 2) {
            videoStorytellerAgeDesc = "a young adult in their 30s";
          } else if (decadesAgo >= 1) {
            videoStorytellerAgeDesc = "a person in their 40s-50s";
          }
        }
      }

      let appearanceInstruction = "";
      let videoProfile: any = null;
      if (profileId) {
        videoProfile = await storage.getStorytellerProfile(profileId);
        if (videoProfile && videoProfile.userId !== userId(req)) videoProfile = null;
      } else {
        const profiles = await storage.getStorytellerProfiles(userId(req));
        if (profiles.length > 0) videoProfile = profiles[0];
      }
      const vidPermanentFeatures = videoProfile?.appearanceDescription ? extractPermanentFeatures(videoProfile.appearanceDescription) : "";
      if (videoProfile?.appearanceDescription) {
        if (videoIsChildStory) {
          appearanceInstruction = `REFERENCE PHOTO: The reference image shows the storyteller [STORYTELLER] as a young person. Draw them EXACTLY as they appear — this IS what they look like in this story. Same face, same features. Key features: ${vidPermanentFeatures}. Do NOT apply the reference face to any adult/parent character. `;
        } else {
          appearanceInstruction = `REFERENCE PHOTO: The person in the reference photo IS the storyteller [STORYTELLER]. Apply these features directly. ${videoProfile.appearanceDescription}. `;
          if (videoStorytellerAgeDesc) {
            appearanceInstruction += `Show them as ${videoStorytellerAgeDesc} — same features but age-adjusted. `;
          }
        }
        appearanceInstruction += `CLOTHING: Same outfit on the storyteller in every scene. `;
      }

      const videoProfilePhotoPath = videoProfile?.photoUrl ? path.join(PUBLIC_DATA_DIR, videoProfile.photoUrl) : null;
      const videoContentRating = story.contentRating || "G";
      const hasReferencePhoto = videoProfilePhotoPath && fs.existsSync(videoProfilePhotoPath);

      const video = await storage.createStoryVideo({
        storyId,
        style,
        status: "generating",
        scenes: [],
      });

      res.status(202).json(video);

      (async () => {
        try {
          let styleInstruction = "";
          if (style === "cartoon") {
            styleInstruction = "in a fun, colorful cartoon/Pixar animation style with bright vivid colors, exaggerated expressions, and child-friendly appeal. The characters should look like animated cartoon characters.";
          } else if (style === "realistic") {
            styleInstruction = "in a photorealistic, cinematic style with natural lighting, detailed textures, and dramatic composition like a movie scene. The people should look like real people in a photograph.";
          } else {
            styleInstruction = `in the authentic art style of the ${story.era || "mid-20th century"} era with period-appropriate colors, textures, and details. Show the people as they would have looked in that era.`;
          }

          const videoStoryText = story.content.substring(0, 1500);

          // Email the storyteller when the movie is done (they may have left the app).
          const owner = story.userId ? await storage.getUser(story.userId) : undefined;
          const notify = async (ok: boolean) => {
            if (!owner?.username) return;
            const mail = ok ? movieReadyEmail(owner.name, story.title, storyId) : movieFailedEmail(owner.name, story.title, storyId);
            await sendEmail(owner.username, mail.subject, mail.html);
          };

          const narrationFor = () => {
            if (!(enableNarration && videoProfile)) return undefined;
            const voice = (videoProfile.voicePreference || undefined) as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" | undefined;
            const voiceSampleUrl = videoProfile.voiceSampleUrl || null;
            if (!voice && !voiceSampleUrl) return undefined;
            console.log(`[VideoGen] Narration enabled: ${voiceSampleUrl ? "own voice" : voice}`);
            return { enabled: true, voice, voiceSampleUrl };
          };

          // FAST PATH: reuse the storybook pictures already made for this story
          // (same style) instead of painting a new set - quicker, cheaper, and the
          // book and the movie match.
          const storybook = (await storage.getIllustrations(storyId))
            .filter((ill) => ill.style === style && ill.imageUrl && fs.existsSync(path.join(PUBLIC_DATA_DIR, ill.imageUrl)))
            .sort((a, b) => (a.sceneOrder ?? 0) - (b.sceneOrder ?? 0))
            // At most 6 scenes, spread across the whole story so the ending is
            // never cut off (always keeps the first and last picture).
            .filter((_, i, all) => {
              const k = Math.min(6, all.length);
              if (all.length <= k) return true;
              const picks = new Set(Array.from({ length: k }, (_, j) => Math.round((j * (all.length - 1)) / (k - 1))));
              return picks.has(i);
            });
          if (storybook.length >= 2) {
            console.log(`[VideoGen] Reusing ${storybook.length} storybook pictures for the movie`);
            let lines: { caption: string; action: string }[] = [];
            try {
              const linesResp = await openai.chat.completions.create({
                model: TEXT_MODEL,
                messages: [
                  {
                    role: "system",
                    content: `You write narration for a short family movie made from a personal story. The movie has ${storybook.length} scenes, one per picture, in order. For EACH scene write:
- "caption": what the storyteller says over that scene, in first person, warm and natural: ONE or TWO short sentences, 25 words maximum, so it can be read in about 8 seconds
- "action": one sentence describing the natural movement happening in that picture (for animating it), moving forwards
Return ONLY a JSON array of ${storybook.length} objects: [{"caption": "...", "action": "..."}]`,
                  },
                  {
                    role: "user",
                    content: `Story:\n${videoStoryText}\n\nScenes:\n${storybook.map((ill, i) => `${i + 1}. ${ill.customText || ill.sceneCaption || ""} | ${ill.prompt.slice(0, 300)}`).join("\n")}`,
                  },
                ],
                max_completion_tokens: 6000,
              });
              const parsed = parseAiJson(linesResp.choices[0]?.message?.content);
              if (Array.isArray(parsed)) lines = parsed;
            } catch (e: any) {
              console.warn("[VideoGen] Narration lines failed, using picture captions:", e?.message);
            }
            const reusedImages = storybook.map((ill, i) => ({
              imagePath: path.join(PUBLIC_DATA_DIR, ill.imageUrl),
              caption: lines[i]?.caption || ill.customText || ill.sceneCaption || story.title,
              action: lines[i]?.action || ill.prompt.slice(0, 400),
            }));
            const reusedScenes = storybook.map((ill, i) => ({ imageUrl: ill.imageUrl, caption: reusedImages[i].caption }));
            await storage.updateStoryVideo(video.id, { storyId, style, status: "generating", scenes: reusedScenes });
            if (cancelledVideoIds.has(video.id)) {
              cancelledVideoIds.delete(video.id);
              return;
            }

            // Quick preview first (about a minute): pans, zooms, fades and narration.
            // The full animated movie replaces it when it's done.
            let preview: { id: number; videoUrl?: string | null } | null = null;
            try {
              const pv = await storage.createStoryVideo({ storyId, style: "preview", status: "generating", scenes: reusedScenes });
              preview = pv;
              const previewUrl = await generatePreviewMovie(reusedImages, `preview-${storyId}-${video.id}-${Date.now()}.mp4`, narrationFor());
              await storage.updateStoryVideo(pv.id, { storyId, style: "preview", status: "complete", videoUrl: previewUrl, scenes: reusedScenes });
              preview = { id: pv.id, videoUrl: previewUrl };
            } catch (e: any) {
              console.warn("[VideoGen] Quick preview failed (full movie continues):", e?.message);
              if (preview) { try { await storage.deleteStoryVideo(preview.id); } catch {} preview = null; }
            }
            const removePreview = async () => {
              if (!preview) return;
              try {
                await storage.deleteStoryVideo(preview.id);
                if (preview.videoUrl) fs.unlinkSync(path.join(PUBLIC_DATA_DIR, preview.videoUrl));
              } catch {}
            };
            if (cancelledVideoIds.has(video.id)) {
              cancelledVideoIds.delete(video.id);
              return;
            }
            const reusedUrl = await withTimeLimit(
              generateVideoFromScenes(reusedImages, `story-${storyId}-${video.id}-${Date.now()}.mp4`, story.title, narrationFor()),
              MOVIE_TIME_LIMIT_MS
            );
            await storage.updateStoryVideo(video.id, { storyId, style, status: "complete", videoUrl: reusedUrl, scenes: reusedScenes });
            await removePreview();
            await notify(true);
            return;
          }

          const videoCharAnalysis = await openai.chat.completions.create({
            model: TEXT_MODEL,
            messages: [
              {
                role: "system",
                content: `You are a story analyst. Read this FIRST-PERSON story carefully. The person saying "I", "me", "my" is the STORYTELLER.

Identify:
1. WHO is the storyteller? What age were they during the events?
2. What other characters appear and what's their relationship to the storyteller?
3. What activity/setting? What would each character realistically wear?

${story.era ? `The story is set in the ${story.era}.` : ""}
${videoProfile?.appearanceDescription ? `The storyteller's CURRENT appearance (from a recent photo): ${videoProfile.appearanceDescription}` : ""}

FOCUS ALL YOUR EFFORT ON THE STORYTELLER. They are the star. Other characters are secondary — just note their role and approximate age.

Respond in JSON:
{
  "storyteller": {
    "ageInStory": "specific age, e.g. about 10 years old / 17 / mid-20s",
    "isChild": true/false (true if under 18),
    "description": "DETAILED physical description for their age IN THE STORY. Ethnicity, skin tone, eye color/shape, nose shape, face shape from current photo. Then age-adjust: if child — small, lean, smooth skin, NO tattoos, NO facial hair, thick full-colored hair. Be very specific.",
    "outfit": "one SPECIFIC outfit — exact colors and garments. If they are a child or teen, it MUST be modest and age-appropriate (e.g. a rash vest and boardshorts for the beach), whatever the story says.",
    "glasses": "yes or no - did they wear glasses AT THIS AGE? Only yes if the story says so, or they are an adult who wears glasses in the photo."
  },
  "otherCharacters": ["dad (adult, 30s)", "friend (same age)"],
  "setting": "brief setting"
}`
              },
              { role: "user", content: videoStoryText }
            ],
            max_completion_tokens: 4000,
          });

          let vidCharInfo: any = null;
          try {
            const rawVidChar = videoCharAnalysis.choices[0]?.message?.content || "{}";
            vidCharInfo = parseAiJson(rawVidChar);
            console.log("[Video] Character analysis:", JSON.stringify(vidCharInfo, null, 2));
          } catch {
            console.warn("[Video] Character analysis parse failed, using defaults");
          }

          const vidStorytellerDesc = `${vidCharInfo?.storyteller?.description || (videoIsChildStory ? "a young child with same ethnicity as reference" : "the main character matching reference photo")} ${glassesLine(vidCharInfo)}`;
          const vidStorytellerAge = vidCharInfo?.storyteller?.ageInStory || (videoIsChildStory ? "about 10 years old" : "");
          const vidStorytellerIsChild = vidCharInfo?.storyteller?.isChild ?? videoIsChildStory;
          const vidStorytellerOutfit = storytellerOutfitFor(vidStorytellerIsChild, vidCharInfo?.storyteller?.outfit || "", story.content);
          const vidOtherCharsSimple = Array.isArray(vidCharInfo?.otherCharacters) ? vidCharInfo.otherCharacters.join(", ") : "";

          const sceneResponse = await openai.chat.completions.create({
            model: TEXT_MODEL,
            messages: [
              {
                role: "system",
                content: `You break personal stories into 4 vivid visual scenes for an AI-generated VIDEO with REAL MOTION. Each scene will be animated into a video clip.

For each scene, provide:
1. A detailed image generation prompt showing a MOMENT OF ACTION — character mid-gesture, mid-step. Describe active pose, clothing, environment with movable elements, camera angle, and lighting.
2. A short caption narrating this moment, spoken aloud over the scene: ONE or TWO short sentences, 25 words maximum in total, so it can be read in about 8 seconds

Design each scene for obvious motion potential.
${story.era ? `\nTIME PERIOD: ${story.era}. Match clothing, hairstyles, vehicles to this period.` : ""}

=== THE STORYTELLER (the star — get them right) ===

The storyteller [STORYTELLER] is: ${vidStorytellerDesc}.
Age in this story: ${vidStorytellerAge}.
Outfit: ${vidStorytellerOutfit || "appropriate for the activity and era"}.
${vidStorytellerIsChild ? "CHILD RULES: Small body, smooth skin, NO tattoos, NO facial hair, NO wrinkles. Thick full-colored hair." : ""}
${vidOtherCharsSimple ? `Other characters: ${vidOtherCharsSimple}. (Secondary — just make them look reasonable. Do NOT make them look like the storyteller.)` : ""}

RULES:
- Write [STORYTELLER] after the storyteller in every scene prompt
- Describe the storyteller in detail in every scene — face, body, age, expression, outfit. They are the STAR.
- Same outfit (${vidStorytellerOutfit || "as above"}) in every scene
- Other characters just need their role mentioned — don't over-describe them

${videoContentRating === "M" ? "CONTENT: Mature — keep the dramatic tension and emotional intensity of the story." : videoContentRating === "PG" ? "CONTENT: PG — tone down graphic violence but keep emotional weight." : "CONTENT: G — fully family-friendly, no violence or danger."}

Return ONLY valid JSON array: [{"prompt": "...", "caption": "..."}, ...]`
              },
              {
                role: "user",
                content: `Break this story into 4 ACTION-RICH scenes ${styleInstruction}:\n\n${videoStoryText}`
              }
            ],
            max_completion_tokens: 10000,
          });

          const rawScenes = sceneResponse.choices[0]?.message?.content || "[]";
          let scenesParsed: { prompt: string; caption: string }[];
          try {
            const parsed = parseAiJson(rawScenes);
            if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Not an array");
            scenesParsed = parsed;
          } catch {
            const c = story.content;
            scenesParsed = [
              { prompt: `A person at the beginning of a personal story. Setting: ${c.substring(0, 150)}. Show the character in the environment described.`, caption: c.substring(0, 80) },
              { prompt: `The story develops. A person experiencing: ${c.substring(Math.floor(c.length * 0.25), Math.floor(c.length * 0.25) + 150)}. Show emotion and action.`, caption: c.substring(Math.floor(c.length * 0.25), Math.floor(c.length * 0.25) + 80) },
              { prompt: `The key moment of the story. A person in: ${c.substring(Math.floor(c.length * 0.5), Math.floor(c.length * 0.5) + 150)}. Dramatic composition.`, caption: c.substring(Math.floor(c.length * 0.5), Math.floor(c.length * 0.5) + 80) },
              { prompt: `The conclusion. A person reflecting: ${c.substring(Math.max(0, c.length - 150))}. Warm, nostalgic mood.`, caption: c.substring(Math.max(0, c.length - 80)) },
            ];
          }

          const sceneImages: ({ imagePath: string; caption: string } | undefined)[] = new Array(scenesParsed.length);
          const scenes: ({ imageUrl: string; caption: string } | undefined)[] = new Array(scenesParsed.length);
          const illDir = path.join(PUBLIC_DATA_DIR, "images", "illustrations");
          if (!fs.existsSync(illDir)) {
            fs.mkdirSync(illDir, { recursive: true });
          }

          let videoConsistencyRefPath: string | null = null;
          let videoAgeTransformedRefPath: string | null = null;

          if (vidStorytellerIsChild && hasReferencePhoto) {
            const vidAgePrompt = `This is a photo of a real person. Generate a portrait of this SAME person but as a ${vidStorytellerAge || "young teenager"}. Keep their EXACT same face — same eyes, same nose, same face shape, same skin tone, same ethnicity. Just make them younger: smooth skin, no wrinkles, full thick hair, youthful features. Same person, just younger. ${glassesLine(vidCharInfo)} Head and shoulders, three-quarter view, natural relaxed expression, looking slightly away from the camera, neutral background.`;
            console.log(`[Child video] Step 0: Generating age-transformed portrait (${vidStorytellerAge})...`);
            try {
              const vidAgeBuf = await generateImageWithReference(videoProfilePhotoPath!, vidAgePrompt, "1024x1024");
              const vidAgeFn = `video-age-transform-${storyId}-${Date.now()}.png`;
              const vidAgePath = path.join(illDir, vidAgeFn);
              fs.writeFileSync(vidAgePath, vidAgeBuf);
              videoAgeTransformedRefPath = vidAgePath;
              console.log(`[Child video] Age-transformed portrait generated successfully`);
            } catch (err: any) {
              console.error("[Child video] Age transform failed, will use original photo:", err?.message);
            }
          }

          const videoEffectiveRefPath = videoAgeTransformedRefPath || videoProfilePhotoPath;

          if (videoEffectiveRefPath && fs.existsSync(videoEffectiveRefPath)) {
            const scene0 = scenesParsed[0];
            const vidCharGuide0 = vidStorytellerIsChild
              ? `The reference image shows the storyteller [STORYTELLER] at ${vidStorytellerAge}. Draw them EXACTLY as they appear in the reference — same face, same hair, same build. ${glassesLine(vidCharInfo)} Outfit: ${vidStorytellerOutfit}. They are the STAR — the largest, most prominent figure. Any adult is a DIFFERENT person who must NOT resemble the reference.`
              : `THE STORYTELLER [STORYTELLER]: ${vidStorytellerDesc}. Age: ${vidStorytellerAge}. Outfit: ${vidStorytellerOutfit}. Apply the reference photo to the storyteller. They are the STAR.`;
            const vidChildNote = vidStorytellerIsChild ? `The storyteller is ${vidStorytellerAge} — draw them as a child/teen exactly matching the reference portrait. ` : "";
            const prompt0 = `${scene0.prompt}. ${vidCharGuide0} ${vidChildNote}${appearanceInstruction}${styleInstruction}. No text or words in the image. Cinematic widescreen composition, 16:9 aspect ratio.`;
            console.log(`Generating video scene 1/${scenesParsed.length} (consistency anchor, child=${vidStorytellerIsChild})...`);
            try {
              const buf0 = await generateImageWithReference(videoEffectiveRefPath, prompt0, "1024x1024");
              const fn0 = `video-${storyId}-${video.id}-scene-0-${Date.now()}.png`;
              const fp0 = path.join(illDir, fn0);
              fs.writeFileSync(fp0, buf0);
              videoConsistencyRefPath = fp0;
              sceneImages[0] = { imagePath: fp0, caption: scene0.caption, action: scene0.prompt };
              scenes[0] = { imageUrl: `/images/illustrations/${fn0}`, caption: scene0.caption };
              console.log(`Video scene 1 done (${videoAgeTransformedRefPath ? "age-transformed" : "original"} anchor saved)`);
            } catch (err: any) {
              console.warn(`Video scene 1 consistency anchor failed:`, err?.message);
            }
          }

          const videoRemaining = videoConsistencyRefPath ? scenesParsed.slice(1) : scenesParsed;

          await parallelBatch(videoRemaining, async (scene, idx) => {
            if (cancelledVideoIds.has(video.id)) throw new Error("Video cancelled");
            const i = videoConsistencyRefPath ? idx + 1 : idx;
            const vidSceneCharGuide = vidStorytellerIsChild
              ? `The reference image shows the storyteller [STORYTELLER] as a child/teen. Match them EXACTLY — same face, same hair, same body size, same outfit (${vidStorytellerOutfit}). ${glassesLine(vidCharInfo)} Age: ${vidStorytellerAge}. They must look identical across all scenes. Any adults are DIFFERENT people.`
              : `THE STORYTELLER [STORYTELLER]: ${vidStorytellerDesc}. Age: ${vidStorytellerAge}. Outfit: ${vidStorytellerOutfit}. Must look IDENTICAL to reference. They are the STAR.`;
            const fullPrompt = `${scene.prompt}. ${vidSceneCharGuide} ${appearanceInstruction}${styleInstruction}. No text or words in the image. Cinematic widescreen composition, 16:9 aspect ratio.`;

            console.log(`Generating video scene ${i + 1}/${scenesParsed.length}...`);
            let imageBuffer: Buffer;
            if (videoConsistencyRefPath && fs.existsSync(videoConsistencyRefPath)) {
              console.log(`Using consistency reference for video scene ${i + 1}`);
              try {
                imageBuffer = await generateImageWithReference(videoConsistencyRefPath, fullPrompt, "1024x1024");
              } catch (refErr: any) {
                console.warn(`Reference failed for video scene ${i + 1}, falling back:`, refErr?.message);
                imageBuffer = await generateImageBuffer(fullPrompt, "1024x1024");
              }
            } else {
              imageBuffer = await generateImageBuffer(fullPrompt, "1024x1024");
            }

            const filename = `video-${storyId}-${video.id}-scene-${i}-${Date.now()}.png`;
            const imagePath = path.join(illDir, filename);
            fs.writeFileSync(imagePath, imageBuffer);

            sceneImages[i] = { imagePath, caption: scene.caption, action: scene.prompt };
            scenes[i] = {
              imageUrl: `/images/illustrations/${filename}`,
              caption: scene.caption,
            };

            const currentScenes = scenes.filter((s): s is { imageUrl: string; caption: string } => s !== undefined);
            await storage.updateStoryVideo(video.id, {
              storyId,
              style,
              status: "generating",
              scenes: currentScenes,
            });
            return true;
          }, 3);

          const validSceneImages = sceneImages.filter((s): s is { imagePath: string; caption: string; action?: string } => s !== undefined);
          const validScenes = scenes.filter((s): s is { imageUrl: string; caption: string } => s !== undefined);

          if (cancelledVideoIds.has(video.id)) {
            console.log(`[VideoGen] Video ${video.id} was cancelled, skipping stitching`);
            cancelledVideoIds.delete(video.id);
            return;
          }

          if (validSceneImages.length === 0) {
            throw new Error("All scene image generations failed - no images to create video from");
          }

          console.log(`All ${validSceneImages.length} video scenes generated, creating video...`);
          const videoFilename = `story-${storyId}-${video.id}-${Date.now()}.mp4`;

          const narrationConfig = narrationFor();

          const videoUrl = await withTimeLimit(
            generateVideoFromScenes(validSceneImages, videoFilename, story.title, narrationConfig),
            MOVIE_TIME_LIMIT_MS
          );

          await storage.updateStoryVideo(video.id, {
            storyId,
            style,
            status: "complete",
            videoUrl,
            scenes: validScenes,
          });
          await notify(true);
        } catch (err: any) {
          const errorMessage = err?.message || "Unknown error";
          console.error("Video generation failed:", errorMessage);
          await storage.updateStoryVideo(video.id, {
            storyId,
            style,
            status: "failed",
            scenes: [],
          });
          // A failed movie doesn't use up one of their goes.
          if (!/cancelled/i.test(errorMessage) && refundMovie) await refundMovie().catch(() => {});
          if (!/cancelled/i.test(errorMessage)) {
            try {
              const owner = story.userId ? await storage.getUser(story.userId) : undefined;
              if (owner?.username) {
                const mail = movieFailedEmail(owner.name, story.title, storyId);
                await sendEmail(owner.username, mail.subject, mail.html);
              }
            } catch {}
          }
        }
      })();
    } catch (error) {
      console.error("Error creating video:", error);
      if (refundMovie) await refundMovie().catch(() => {});
      res.status(500).json({ error: friendlyAiError(error) });
    }
  });

  app.get("/api/videos/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const video = await storage.getStoryVideo(id);
      if (!video) return res.status(404).json({ error: "Video not found" });
      res.json(video);
    } catch (error) {
      console.error("Error fetching video:", error);
      res.status(500).json({ error: "Failed to fetch video" });
    }
  });

  app.post("/api/videos/:id/cancel", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      cancelledVideoIds.add(id);
      await storage.updateStoryVideo(id, { status: "failed" } as any);
      console.log(`[VideoGen] Video ${id} cancelled by user`);
      res.json({ status: "cancelled" });
    } catch (error) {
      console.error("Error cancelling video:", error);
      res.status(500).json({ error: "Failed to cancel video" });
    }
  });

  app.delete("/api/videos/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      cancelledVideoIds.add(id);
      const video = await storage.getStoryVideo(id);
      await storage.deleteStoryVideo(id);
      // Free the storage too: the movie file and the pictures made for it.
      if (video) {
        const files = [video.videoUrl, ...((video.scenes as any[]) || []).map((s) => s?.imageUrl)].filter(Boolean) as string[];
        for (const url of files) {
          // Only files made for this movie - never storybook pictures it reused.
          if (!/^\/(videos\/|images\/illustrations\/video-)/.test(url)) continue;
          const filePath = path.join(PUBLIC_DATA_DIR, url);
          if (filePath.startsWith(PUBLIC_DATA_DIR)) { try { fs.unlinkSync(filePath); } catch {} }
        }
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting video:", error);
      res.status(500).json({ error: "Failed to delete video" });
    }
  });

  app.get("/api/storyteller-profiles", async (req, res) => {
    try {
      const profiles = await storage.getStorytellerProfiles(userId(req));
      res.json(profiles);
    } catch (error) {
      console.error("Error fetching profiles:", error);
      res.status(500).json({ error: "Failed to fetch profiles" });
    }
  });

  app.get("/api/storyteller-profiles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const profile = await storage.getStorytellerProfile(id);
      if (!profile) return res.status(404).json({ error: "Profile not found" });
      res.json(profile);
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  async function analyzeAppearanceFromPhotos(photoDataList: { base64: string; url: string }[]): Promise<string | undefined> {
    if (photoDataList.length === 0) return undefined;
    try {
      const imageMessages: any[] = photoDataList.map((p, i) => ({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${p.base64}` }
      }));

      const photoCount = photoDataList.length;
      const userContent: any[] = [
        {
          type: "text",
          text: photoCount === 1
            ? "Please analyze this person's physical appearance in detail. I need both their PERMANENT FEATURES (things that stay the same at any age) and their CURRENT AGE-SPECIFIC features."
            : `I'm providing ${photoCount} photos of the SAME person from different angles. Analyze ALL photos together for the most accurate description. I need both their PERMANENT FEATURES and CURRENT AGE-SPECIFIC features.`
        },
        ...imageMessages
      ];

      const visionResponse = await openai.chat.completions.create({
        model: TEXT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a visual appearance analyst for an illustrated storybook app. This person will be drawn as a character at DIFFERENT AGES (child, teen, adult, elderly).

Provide your description in this EXACT format:

PERMANENT FEATURES (these NEVER change with age — use these to draw this person at ANY age, even as a child):
Ethnicity: [specific ethnicity/heritage]
Skin tone: [specific shade — e.g. fair, olive, medium-tan, deep brown]
Eye color: [color — estimate from photos even if not perfectly clear]
Eye shape: [specific shape — round, almond, hooded, deep-set, wide-set. Estimate if partially visible]
Nose: [shape — broad, narrow, button, aquiline, rounded tip, upturned. Estimate from profile/angle views]
Face shape: [oval, round, square, heart-shaped, long, diamond]
Jawline: [strong/angular, soft/rounded, prominent, narrow]
Ear shape: [prominent, close-set, larger lobes — if visible]
Distinctive marks: [birthmarks, dimples, cleft chin, freckles ONLY — NOT tattoos, NOT glasses, NOT beard]

IMPORTANT: Tattoos, glasses, beards, body hair are NOT permanent features — they go in CURRENT APPEARANCE.
IMPORTANT: Even if facial features are partially obscured, make your best estimate from available angles. Never write "Not visible" — always provide your best assessment.

CURRENT APPEARANCE (how they look NOW — age-specific, these would NOT appear on a child version):
Age: [estimated age range]
Gender: [gender]
Hair: [current color, style, thickness, balding pattern if any]
Build: [current body type]
Other: [glasses, beard, tattoos, wrinkles, grey hair, body hair — things that are age-specific or chosen]

Be extremely specific. ${photoCount > 1 ? "Cross-reference ALL photos for accuracy." : ""} Do NOT describe clothing.`
          },
          { role: "user", content: userContent }
        ],
        max_completion_tokens: 4000,
      });
      return visionResponse.choices[0]?.message?.content || undefined;
    } catch (visionErr: any) {
      console.error("Vision analysis failed:", visionErr?.message || visionErr);
      return undefined;
    }
  }

  function extractPermanentFeatures(appearanceDescription: string): string {
    const permanentMatch = appearanceDescription.match(/PERMANENT FEATURES[^:]*:([\s\S]*?)(?:CURRENT APPEARANCE|$)/i);
    if (permanentMatch) {
      return permanentMatch[1].trim();
    }
    const desc = appearanceDescription
      .replace(/tattoo[s]?[^.;,\n]*/gi, "")
      .replace(/beard[^.;,\n]*/gi, "")
      .replace(/wrinkle[s]?[^.;,\n]*/gi, "")
      .replace(/grey|gray|greying|graying|white hair|bald[^.;,\n]*/gi, "")
      .replace(/muscular|stocky|heavy.?set|large build[^.;,\n]*/gi, "")
      .replace(/glass(es)?[^.;,\n]*/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return desc || appearanceDescription;
  }

  app.post("/api/storyteller-profiles", async (req, res) => {
    try {
      const { name, photo } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });

      let photoUrl: string | undefined;
      let appearanceDescription: string | undefined;

      if (photo) {
        const photoBuffer = Buffer.from(photo, "base64");
        const filename = `profile-${Date.now()}.jpg`;
        const photoDir = path.join(PUBLIC_DATA_DIR, "images", "profiles");
        if (!fs.existsSync(photoDir)) {
          fs.mkdirSync(photoDir, { recursive: true });
        }
        const photoPath = path.join(photoDir, filename);
        fs.writeFileSync(photoPath, photoBuffer);
        photoUrl = `/images/profiles/${filename}`;

        appearanceDescription = await analyzeAppearanceFromPhotos([{ base64: photo, url: photoUrl }]);
      }

      const { voicePreference } = req.body;
      const profile = await storage.createStorytellerProfile({
        userId: userId(req),
        name,
        photoUrl: photoUrl || null,
        additionalPhotos: null,
        appearanceDescription: appearanceDescription || null,
        voicePreference: voicePreference || null,
        voiceSampleUrl: null,
      });

      res.status(201).json(profile);
    } catch (error) {
      console.error("Error creating profile:", error);
      res.status(500).json({ error: "Failed to create profile" });
    }
  });

  app.post("/api/storyteller-profiles/:id/reanalyze", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const profile = await storage.getStorytellerProfile(id);
      if (!profile) return res.status(404).json({ error: "Profile not found" });

      const allPhotos: { base64: string; url: string }[] = [];
      if (profile.photoUrl) {
        const mainPath = path.join(PUBLIC_DATA_DIR, profile.photoUrl);
        if (fs.existsSync(mainPath)) {
          allPhotos.push({ base64: fs.readFileSync(mainPath).toString("base64"), url: profile.photoUrl });
        }
      }
      if (profile.additionalPhotos) {
        for (const url of profile.additionalPhotos) {
          const p = path.join(PUBLIC_DATA_DIR, url);
          if (fs.existsSync(p)) {
            allPhotos.push({ base64: fs.readFileSync(p).toString("base64"), url });
          }
        }
      }

      if (allPhotos.length === 0) return res.status(400).json({ error: "No photos to analyze" });

      const newDescription = await analyzeAppearanceFromPhotos(allPhotos);
      if (newDescription) {
        const updated = await storage.updateStorytellerProfile(id, { appearanceDescription: newDescription });
        console.log("[Profile] Re-analyzed appearance with new structured format");
        res.json(updated);
      } else {
        res.status(500).json({ error: "Analysis failed" });
      }
    } catch (error) {
      console.error("Error re-analyzing profile:", error);
      res.status(500).json({ error: "Failed to re-analyze" });
    }
  });

  app.patch("/api/storyteller-profiles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, photo } = req.body;
      const updates: Record<string, any> = {};

      if (name) updates.name = name;

      if (photo) {
        const photoBuffer = Buffer.from(photo, "base64");
        const filename = `profile-${id}-${Date.now()}.jpg`;
        const photoDir = path.join(PUBLIC_DATA_DIR, "images", "profiles");
        if (!fs.existsSync(photoDir)) {
          fs.mkdirSync(photoDir, { recursive: true });
        }
        const photoPath = path.join(photoDir, filename);
        fs.writeFileSync(photoPath, photoBuffer);
        updates.photoUrl = `/images/profiles/${filename}`;

        const existingProfile = await storage.getStorytellerProfile(id);
        const allPhotos: { base64: string; url: string }[] = [{ base64: photo, url: updates.photoUrl }];
        if (existingProfile?.additionalPhotos) {
          for (const additionalUrl of existingProfile.additionalPhotos) {
            const filePath = path.join(PUBLIC_DATA_DIR, additionalUrl);
            if (fs.existsSync(filePath)) {
              const buf = fs.readFileSync(filePath);
              allPhotos.push({ base64: buf.toString("base64"), url: additionalUrl });
            }
          }
        }
        updates.appearanceDescription = await analyzeAppearanceFromPhotos(allPhotos) || undefined;
      }

      const profile = await storage.updateStorytellerProfile(id, updates);
      if (!profile) return res.status(404).json({ error: "Profile not found" });
      res.json(profile);
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.post("/api/storyteller-profiles/:id/photos", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { photo } = req.body;
      if (!photo) return res.status(400).json({ error: "Photo is required" });

      const profile = await storage.getStorytellerProfile(id);
      if (!profile) return res.status(404).json({ error: "Profile not found" });

      const photoBuffer = Buffer.from(photo, "base64");
      const filename = `profile-${id}-extra-${Date.now()}.jpg`;
      const photoDir = path.join(PUBLIC_DATA_DIR, "images", "profiles");
      if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
      fs.writeFileSync(path.join(photoDir, filename), photoBuffer);
      const newPhotoUrl = `/images/profiles/${filename}`;

      const currentAdditional = profile.additionalPhotos || [];
      const updatedAdditional = [...currentAdditional, newPhotoUrl];

      const allPhotos: { base64: string; url: string }[] = [];
      if (profile.photoUrl) {
        const mainPath = path.join(PUBLIC_DATA_DIR, profile.photoUrl);
        if (fs.existsSync(mainPath)) {
          allPhotos.push({ base64: fs.readFileSync(mainPath).toString("base64"), url: profile.photoUrl });
        }
      }
      for (const url of updatedAdditional) {
        const filePath = path.join(PUBLIC_DATA_DIR, url);
        if (fs.existsSync(filePath)) {
          allPhotos.push({ base64: fs.readFileSync(filePath).toString("base64"), url });
        }
      }

      const appearanceDescription = await analyzeAppearanceFromPhotos(allPhotos);

      const updated = await storage.updateStorytellerProfile(id, {
        additionalPhotos: updatedAdditional,
        appearanceDescription: appearanceDescription || profile.appearanceDescription,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error adding photo:", error);
      res.status(500).json({ error: "Failed to add photo" });
    }
  });

  // Add several photos at once (the guided selfie step) and study the face once.
  app.post("/api/storyteller-profiles/:id/photos/batch", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const photos: string[] = Array.isArray(req.body?.photos) ? req.body.photos.filter((p: any) => typeof p === "string" && p.length > 0).slice(0, 6) : [];
      if (photos.length === 0) return res.status(400).json({ error: "Photos are required" });

      const profile = await storage.getStorytellerProfile(id);
      if (!profile) return res.status(404).json({ error: "Profile not found" });

      const photoDir = path.join(PUBLIC_DATA_DIR, "images", "profiles");
      if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
      const newUrls: string[] = [];
      photos.forEach((photo, i) => {
        const filename = `profile-${id}-extra-${Date.now()}-${i}.jpg`;
        fs.writeFileSync(path.join(photoDir, filename), Buffer.from(photo, "base64"));
        newUrls.push(`/images/profiles/${filename}`);
      });

      const updatedAdditional = [...(profile.additionalPhotos || []), ...newUrls];
      const allPhotos: { base64: string; url: string }[] = [];
      for (const url of [profile.photoUrl, ...updatedAdditional].filter(Boolean) as string[]) {
        const filePath = path.join(PUBLIC_DATA_DIR, url);
        if (fs.existsSync(filePath)) allPhotos.push({ base64: fs.readFileSync(filePath).toString("base64"), url });
      }
      const appearanceDescription = await analyzeAppearanceFromPhotos(allPhotos);
      const updated = await storage.updateStorytellerProfile(id, {
        additionalPhotos: updatedAdditional,
        appearanceDescription: appearanceDescription || profile.appearanceDescription,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error adding photos:", error);
      res.status(500).json({ error: "Failed to add photos" });
    }
  });

  app.delete("/api/storyteller-profiles/:id/photos", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { photoUrl } = req.body;
      if (!photoUrl) return res.status(400).json({ error: "photoUrl is required" });

      const profile = await storage.getStorytellerProfile(id);
      if (!profile) return res.status(404).json({ error: "Profile not found" });

      const currentAdditional = profile.additionalPhotos || [];
      const updatedAdditional = currentAdditional.filter(u => u !== photoUrl);

      const allPhotos: { base64: string; url: string }[] = [];
      if (profile.photoUrl) {
        const mainPath = path.join(PUBLIC_DATA_DIR, profile.photoUrl);
        if (fs.existsSync(mainPath)) {
          allPhotos.push({ base64: fs.readFileSync(mainPath).toString("base64"), url: profile.photoUrl });
        }
      }
      for (const url of updatedAdditional) {
        const filePath = path.join(PUBLIC_DATA_DIR, url);
        if (fs.existsSync(filePath)) {
          allPhotos.push({ base64: fs.readFileSync(filePath).toString("base64"), url });
        }
      }

      const appearanceDescription = allPhotos.length > 0
        ? (await analyzeAppearanceFromPhotos(allPhotos) || profile.appearanceDescription)
        : profile.appearanceDescription;

      const updated = await storage.updateStorytellerProfile(id, {
        additionalPhotos: updatedAdditional.length > 0 ? updatedAdditional : null,
        appearanceDescription,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error removing photo:", error);
      res.status(500).json({ error: "Failed to remove photo" });
    }
  });

  app.delete("/api/storyteller-profiles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteStorytellerProfile(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting profile:", error);
      res.status(500).json({ error: "Failed to delete profile" });
    }
  });

  app.post("/api/preview-voice", async (req, res) => {
    try {
      const { voice, text } = req.body;
      const validVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
      if (!voice || !validVoices.includes(voice)) {
        return res.status(400).json({ error: "Invalid voice" });
      }
      const sampleText = text || "Hello, I'm going to tell you a story about the most wonderful summer of my life.";
      const audioBuffer = await textToSpeech(sampleText, voice, "mp3");
      res.set("Content-Type", "audio/mpeg");
      res.send(audioBuffer);
    } catch (error) {
      console.error("Error previewing voice:", error);
      res.status(500).json({ error: "Failed to generate voice preview" });
    }
  });

  // Play the owner's own voice recording (the ownership check runs before this).
  app.get("/api/storyteller-profiles/:id/voice-sample", async (req, res) => {
    try {
      const profile = await storage.getStorytellerProfile(parseInt(req.params.id));
      const file = voiceSamplePath(profile?.voiceSampleUrl);
      if (!file || !fs.existsSync(file)) return res.status(404).json({ error: "No recording" });
      res.setHeader("Cache-Control", "private, no-store");
      res.type(file.endsWith(".mp4") || file.endsWith(".m4a") ? "audio/mp4" : "audio/webm");
      fs.createReadStream(file).pipe(res);
    } catch (error) {
      console.error("Error playing voice sample:", error);
      res.status(500).json({ error: "Could not play the recording" });
    }
  });

  app.patch("/api/storyteller-profiles/:id/voice", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { voicePreference, voiceSample } = req.body;
      const updates: Record<string, any> = {};

      if (voicePreference !== undefined) {
        const validVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", null];
        if (voicePreference !== null && !validVoices.includes(voicePreference)) {
          return res.status(400).json({ error: "Invalid voice preference" });
        }
        updates.voicePreference = voicePreference;
      }

      if (voiceSample) {
        const audioBuffer = Buffer.from(voiceSample, "base64");
        // Private folder - never served by link (see voice-samples.ts).
        fs.mkdirSync(VOICE_DIR, { recursive: true });
        const filename = `voice-${id}-${Date.now()}.webm`;
        fs.writeFileSync(path.join(VOICE_DIR, filename), audioBuffer);
        // Remove the previous recording.
        const before = await storage.getStorytellerProfile(id);
        const oldPath = voiceSamplePath(before?.voiceSampleUrl);
        if (oldPath && fs.existsSync(oldPath)) { try { fs.unlinkSync(oldPath); } catch {} }
        updates.voiceSampleUrl = voiceSampleUrlFor(id, filename);
      }

      if (voiceSample === null) {
        const before = await storage.getStorytellerProfile(id);
        const oldPath = voiceSamplePath(before?.voiceSampleUrl);
        if (oldPath && fs.existsSync(oldPath)) { try { fs.unlinkSync(oldPath); } catch {} }
        updates.voiceSampleUrl = null;
      }

      const profile = await storage.updateStorytellerProfile(id, updates);
      if (!profile) return res.status(404).json({ error: "Profile not found" });
      res.json(profile);
    } catch (error) {
      console.error("Error updating voice settings:", error);
      res.status(500).json({ error: "Failed to update voice settings" });
    }
  });

  app.post("/api/suggest-title", async (req, res) => {
    try {
      const { content } = req.body;
      if (!content) return res.status(400).json({ error: "Content required" });

      const response = await openai.chat.completions.create({
        model: TEXT_MODEL,
        messages: [
          {
            role: "system",
            content: "Generate a short, warm, evocative title for this personal story/memory. The title should be 3-8 words. Return ONLY the title, nothing else."
          },
          { role: "user", content: content.substring(0, 500) }
        ],
        max_completion_tokens: 2000,
      });

      const title = response.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '') || "My Story";
      res.json({ title });
    } catch (error) {
      console.error("Error suggesting title:", error);
      res.status(500).json({ error: "Failed to suggest title" });
    }
  });

  app.get("/api/stripe/publishable-key", async (_req, res) => {
    try {
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch (error) {
      console.error("Error getting Stripe key:", error);
      res.status(500).json({ error: "Failed to get payment config" });
    }
  });

  app.get("/api/stripe/products", async (_req, res) => {
    try {
      const stripe = await getUncachableStripeClient();
      const products = await stripe.products.list({ active: true, limit: 10 });
      const result = [];
      for (const product of products.data) {
        const prices = await stripe.prices.list({ product: product.id, active: true, limit: 1 });
        const price = prices.data[0];
        if (price) {
          result.push({
            id: product.id,
            name: product.name,
            description: product.description,
            metadata: product.metadata,
            price_id: price.id,
            unit_amount: price.unit_amount,
            currency: price.currency,
          });
        }
      }
      result.sort((a, b) => (a.unit_amount || 0) - (b.unit_amount || 0));
      res.json(result);
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ error: "Failed to fetch products" });
    }
  });

  app.post("/api/stripe/checkout", async (req, res) => {
    try {
      const { priceId, storyId, productType } = req.body;
      const sessionId = userId(req);
      if (!priceId || !storyId || !productType) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      if (!(await userOwnsStory(req, Number(storyId)))) {
        return res.status(404).json({ error: "Story not found" });
      }

      const stripe = await getUncachableStripeClient();
      const baseUrl = `${req.protocol}://${req.get('host')}`;

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'payment',
        success_url: `${baseUrl}/stories/${storyId}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/stories/${storyId}?payment=cancelled`,
        metadata: {
          storyId: String(storyId),
          productType,
          sessionId,
        },
      });

      await storage.createPurchase({
        sessionId,
        storyId,
        productType,
        stripeSessionId: session.id,
        status: "pending",
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error("Error creating checkout:", error);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  app.post("/api/stripe/verify-payment", async (req, res) => {
    try {
      const { sessionId: stripeSessionId } = req.body;
      if (!stripeSessionId) {
        return res.status(400).json({ error: "Missing session ID" });
      }

      const purchase = await storage.getPurchaseByStripeSession(stripeSessionId);
      if (!purchase) {
        return res.status(404).json({ error: "Purchase not found" });
      }

      if (purchase.sessionId !== userId(req)) {
        return res.status(404).json({ error: "Purchase not found" });
      }

      if (purchase.status === "paid") {
        return res.json({ status: "paid", productType: purchase.productType });
      }

      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(stripeSessionId);

      if (session.payment_status === "paid") {
        await storage.updatePurchaseStatus(
          stripeSessionId,
          "paid",
          session.payment_intent as string
        );
        res.json({ status: "paid", productType: session.metadata?.productType });
      } else {
        res.json({ status: session.payment_status });
      }
    } catch (error) {
      console.error("Error verifying payment:", error);
      res.status(500).json({ error: "Failed to verify payment" });
    }
  });

  app.get("/api/stories/:id/purchases", async (req, res) => {
    try {
      const storyId = parseInt(req.params.id);
      // The app owner can download everything for free (for testing and their own family).
      if (await isOwner(req)) {
        return res.json([{ id: 0, sessionId: userId(req), storyId, productType: "bundle_download", status: "paid", stripeSessionId: null, stripePaymentIntentId: null, createdAt: new Date() }]);
      }
      const purchasesList = await storage.getPurchasesForStory(userId(req), storyId);
      res.json(purchasesList);
    } catch (error) {
      console.error("Error fetching purchases:", error);
      res.status(500).json({ error: "Failed to fetch purchases" });
    }
  });

  app.post("/api/stories/:id/share", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const story = await storage.getStory(id);
      if (!story) return res.status(404).json({ error: "Story not found" });

      const { giftMessage } = req.body;
      let shareToken = story.shareToken;
      if (!shareToken) {
        shareToken = crypto.randomUUID().replace(/-/g, "").substring(0, 16);
      }
      const updated = await storage.updateStory(id, { shareToken, giftMessage: giftMessage || null } as any);
      res.json({ shareToken: updated?.shareToken, giftMessage: updated?.giftMessage });
    } catch (error) {
      console.error("Error sharing story:", error);
      res.status(500).json({ error: "Failed to share story" });
    }
  });

  app.get("/api/shared/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const story = await storage.getStoryByShareToken(token);
      if (!story) return res.status(404).json({ error: "Story not found" });

      const illustrationsList = await storage.getIllustrations(story.id);
      res.json({ ...story, illustrations: illustrationsList });
    } catch (error) {
      console.error("Error fetching shared story:", error);
      res.status(500).json({ error: "Failed to fetch shared story" });
    }
  });

  app.get("/api/stories/:id/perspectives", async (req, res) => {
    try {
      const storyId = parseInt(req.params.id);
      const perspectives = await storage.getStoryPerspectives(storyId);
      res.json(perspectives);
    } catch (error) {
      console.error("Error fetching perspectives:", error);
      res.status(500).json({ error: "Failed to fetch perspectives" });
    }
  });

  app.post("/api/stories/:id/perspectives", async (req, res) => {
    try {
      const storyId = parseInt(req.params.id);
      const story = await storage.getStory(storyId);
      if (!story) return res.status(404).json({ error: "Story not found" });

      const { authorName, content } = req.body;
      if (!authorName || !content) {
        return res.status(400).json({ error: "Author name and content are required" });
      }

      const perspective = await storage.createStoryPerspective({
        storyId,
        authorName,
        content,
      });
      res.status(201).json(perspective);
    } catch (error) {
      console.error("Error creating perspective:", error);
      res.status(500).json({ error: "Failed to create perspective" });
    }
  });

  app.delete("/api/perspectives/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteStoryPerspective(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting perspective:", error);
      res.status(500).json({ error: "Failed to delete perspective" });
    }
  });

  app.get("/api/stories/:id/download/pdf", async (req, res) => {
    try {
      const storyId = parseInt(req.params.id);
      const purchasesList = await storage.getPurchasesForStory(userId(req), storyId);
      const hasPdf = (await isOwner(req)) || purchasesList.some(p => p.productType === "pdf_download" || p.productType === "bundle_download");
      if (!hasPdf) return res.status(403).json({ error: "Purchase required" });

      const story = await storage.getStory(storyId);
      if (!story) return res.status(404).json({ error: "Story not found" });

      const illustrationsList = await storage.getIllustrations(storyId);

      const profiles = await storage.getStorytellerProfiles(userId(req));
      const storytellerName = profiles.length > 0 ? profiles[0].name : "";

      const imageToBase64 = (relUrl: string): string => {
        try {
          let filePath = path.join(PUBLIC_DATA_DIR, relUrl);
          // Book-sized JPEG copy (~200 KB instead of ~2 MB) so the PDF is small enough to email.
          const small = filePath.replace(/\.(png|jpe?g)$/i, "") + ".book.jpg";
          if (fs.existsSync(filePath) && !fs.existsSync(small)) {
            try {
              execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", filePath, "-vf", "scale='min(1400,iw)':-2", "-q:v", "4", small], { timeout: 20000 });
            } catch {}
          }
          if (fs.existsSync(small)) filePath = small;
          if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath);
            const ext = path.extname(filePath).replace(".", "").toLowerCase();
            const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : "image/png";
            return `data:${mime};base64,${data.toString("base64")}`;
          }
        } catch {}
        return relUrl;
      };

      const createdDate = story.createdAt ? new Date(story.createdAt).toLocaleDateString("en-AU", { year: "numeric", month: "long", day: "numeric", timeZone: process.env.APP_TIMEZONE || "Australia/Brisbane" }) : "";

      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      // Give each picture its part of the story, in order, like a picture book.
      // Pictures were made by splitting the story evenly, so an even split of the
      // sentences lines up with them.
      const passages: string[][] = (() => {
        const n = illustrationsList.length;
        if (n === 0) return [];
        const paras = story.content.split(/\n+/).map((p) => p.trim()).filter(Boolean);
        const sentences: { text: string; newPara: boolean }[] = [];
        paras.forEach((p) => {
          const parts = p.match(/[^.!?]+[.!?]+["'\u201D\u2019)]*\s*|[^.!?]+$/g) || [p];
          parts.forEach((t, i) => t.trim() && sentences.push({ text: t.trim(), newPara: i === 0 }));
        });
        const total = sentences.reduce((a, x) => a + x.text.length, 0) || 1;
        const out: string[][] = Array.from({ length: n }, () => []);
        let acc = 0;
        sentences.forEach((x) => {
          const mid = acc + x.text.length / 2;
          const idx = Math.min(n - 1, Math.floor((mid / total) * n));
          const page = out[idx];
          if (page.length === 0 || x.newPara) page.push(x.text);
          else page[page.length - 1] += " " + x.text;
          acc += x.text.length;
        });
        return out;
      })();
      const totalPages = 1 + (story.giftMessage ? 1 : 0) + (illustrationsList.length ? 0 : 1) + illustrationsList.length + 1;

      let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${story.title} — Storyteller</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&display=swap" rel="stylesheet">
<style>
@page {
  size: A4;
  margin: 0;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  font-family: 'Lora', Georgia, 'Times New Roman', serif;
  color: #3C2415;
  background: #FFFBF5;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.page {
  width: 210mm;
  min-height: 297mm;
  padding: 25mm 30mm;
  page-break-after: always;
  position: relative;
  background: #FFFBF5;
}
.page:last-child {
  page-break-after: auto;
}
.illustration-page { display: flex; flex-direction: column; align-items: center; padding-top: 18mm; }
.illustration-page .illustration-image-wrapper img { max-height: 150mm; width: auto; max-width: 100%; }
.page-text { margin-top: 9mm; max-width: 150mm; font-size: 15pt; line-height: 1.6; color: #3C2415; text-align: left; }
.page-text p { margin: 0 0 4mm; }
.page-text.first p:first-child::first-letter { float: left; font-size: 3.2em; line-height: 0.9; padding: 1mm 2mm 0 0; color: #8B3A0F; font-weight: 700; }
.page-number {
  position: absolute;
  bottom: 15mm;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 11px;
  color: #B8860B;
  letter-spacing: 2px;
  font-variant-numeric: oldstyle-nums;
}

/* Cover page */
.cover-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: linear-gradient(180deg, #FFFBF5 0%, #FEF3E2 40%, #FDE9C8 100%);
}
.cover-ornament {
  width: 60px;
  height: 2px;
  background: linear-gradient(90deg, transparent, #B8860B, transparent);
  margin: 16px auto;
}
.cover-image-wrapper {
  width: 120mm;
  max-height: 140mm;
  margin: 20px auto;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(146, 64, 14, 0.15);
  border: 1px solid rgba(184, 134, 11, 0.2);
}
.cover-image-wrapper img {
  width: 100%;
  height: auto;
  display: block;
  object-fit: cover;
}
.cover-title {
  font-size: 32px;
  font-weight: 700;
  color: #78350F;
  line-height: 1.2;
  margin-top: 20px;
  letter-spacing: 0.5px;
}
.cover-subtitle {
  font-size: 16px;
  font-weight: 400;
  color: #92400E;
  margin-top: 8px;
  font-style: italic;
}
.cover-author {
  font-size: 18px;
  font-weight: 500;
  color: #A16207;
  margin-top: 20px;
  letter-spacing: 1px;
}
.cover-date {
  font-size: 13px;
  color: #B8860B;
  margin-top: 6px;
  letter-spacing: 1.5px;
}
.cover-footer {
  margin-top: auto;
  padding-top: 20px;
  font-size: 11px;
  color: #C5975B;
  letter-spacing: 2px;
  text-transform: uppercase;
}

/* Dedication page */
.dedication-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: #FFFBF5;
}
.dedication-label {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 3px;
  color: #B8860B;
  margin-bottom: 24px;
}
.dedication-text {
  font-size: 20px;
  font-style: italic;
  color: #78350F;
  line-height: 1.8;
  max-width: 120mm;
  margin: 0 auto;
}
.dedication-ornament {
  width: 40px;
  height: 2px;
  background: linear-gradient(90deg, transparent, #B8860B, transparent);
  margin: 28px auto;
}

/* Story text page */
.story-page {
  background: #FFFBF5;
}
.story-page h2 {
  font-size: 24px;
  font-weight: 600;
  color: #78350F;
  text-align: center;
  margin-bottom: 8px;
}
.story-meta {
  text-align: center;
  font-size: 13px;
  color: #A16207;
  margin-bottom: 24px;
  font-style: italic;
}
.story-text p {
  font-size: 14px;
  line-height: 1.9;
  margin-bottom: 14px;
  text-align: justify;
  hyphens: auto;
  color: #3C2415;
}
.story-text p:first-of-type::first-letter {
  font-size: 42px;
  float: left;
  line-height: 1;
  padding-right: 6px;
  color: #92400E;
  font-weight: 700;
}

/* Illustration page */
.illustration-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 20mm;
  background: #FFFBF5;
}
.illustration-scene-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 3px;
  color: #B8860B;
  margin-bottom: 12px;
}
.illustration-image-wrapper {
  width: 150mm;
  max-height: 180mm;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(146, 64, 14, 0.12);
  border: 1px solid rgba(184, 134, 11, 0.15);
}
.illustration-image-wrapper img {
  width: 100%;
  height: auto;
  display: block;
  object-fit: contain;
}
/* Frame hugs the picture - no white strip beside a height-limited picture. */
.illustration-page .illustration-image-wrapper { width: auto; max-width: 150mm; display: inline-block; line-height: 0; }
.illustration-page .illustration-image-wrapper img { width: auto !important; max-width: 150mm; }
.illustration-caption {
  margin-top: 16px;
  font-size: 15px;
  font-style: italic;
  color: #78350F;
  text-align: center;
  max-width: 130mm;
  line-height: 1.6;
}
.illustration-custom-text {
  margin-top: 10px;
  font-size: 13px;
  color: #92400E;
  text-align: center;
  max-width: 130mm;
  line-height: 1.6;
}

/* Colophon / back page */
.colophon-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: linear-gradient(180deg, #FFFBF5 0%, #FEF3E2 100%);
}
.colophon-logo {
  font-size: 22px;
  font-weight: 700;
  color: #78350F;
  letter-spacing: 1px;
  margin-bottom: 8px;
}
.colophon-tagline {
  font-size: 13px;
  font-style: italic;
  color: #A16207;
  margin-bottom: 24px;
}
.colophon-info {
  font-size: 12px;
  color: #B8860B;
  line-height: 1.8;
}

.save-bar { position: sticky; top: 0; left: 0; right: 0; width: 100%; z-index: 10; display: flex; gap: 10px; justify-content: center; align-items: center; flex-wrap: wrap; padding: 12px 16px; background: #fdf8f1; border-bottom: 1px solid #e8dccb; font-family: Lora, Georgia, serif; }
.save-bar button { font: inherit; font-size: 18px; background: #c2570c; color: #fff; border: 0; border-radius: 10px; padding: 12px 22px; cursor: pointer; }
.save-bar button.close { background: #fff; color: #3C2415; border: 1px solid #d9c8b4; }
.save-bar span { font-size: 14px; color: #7a6a5c; width: 100%; text-align: center; }
#book { transform-origin: top left; }
@media print {
  .save-bar { display: none !important; }
  /* Phones add their own print margins, so a full 297mm page spilled onto a
     blank second sheet. Pages size to their content and break cleanly. */
  .page { width: 100% !important; min-height: 0 !important; height: auto !important; padding: 12mm 16mm !important; break-after: page; page-break-after: always; break-inside: avoid; }
  .page:last-child { break-after: auto; page-break-after: auto; }
  /* Leave room for the margins phones add when printing, so nothing spills onto a blank sheet. */
  .cover-page { min-height: 225mm !important; max-height: 245mm; overflow: hidden; }
  .illustration-page .illustration-image-wrapper img { max-height: 132mm !important; }
  .page-text { font-size: 13.5pt !important; margin-top: 6mm !important; }
  .page { max-height: 250mm; overflow: hidden; }
  .page-number { position: static !important; margin-top: 5mm; }
  html, body { background: #FFFBF5 !important; }
  .page { margin: 0; box-shadow: none; }
}
@media screen {
  .page {
    margin: 20px auto;
    box-shadow: 0 2px 20px rgba(0,0,0,0.1);
  }
}
</style>
</head>
<body>
<div class="save-bar"><button class="close" onclick="closeBook()">✕ Close</button><button onclick="window.print()">Save as PDF / Print</button><span>On iPhone: tap Save, then Share → Save to Files</span></div>
<div id="book">`;

      let pageNum = 0;

      // --- Cover Page ---
      pageNum++;
      html += `<div class="page cover-page">`;
      // Cover: a picture from the action (about 60% through the story) so the
      // book doesn't open on the same picture twice.
      const coverUrl = illustrationsList.length >= 3
        ? illustrationsList[Math.min(illustrationsList.length - 1, Math.floor(illustrationsList.length * 0.6))].imageUrl
        : story.coverImageUrl;
      if (coverUrl) {
        html += `<div class="cover-image-wrapper"><img src="${imageToBase64(coverUrl)}" alt="Cover"></div>`;
      }
      html += `<div class="cover-ornament"></div>`;
      html += `<div class="cover-title">${story.title}</div>`;
      if (story.era || story.category) {
        html += `<div class="cover-subtitle">${[story.era, story.category].filter(Boolean).join(" \u00B7 ")}</div>`;
      }
      if (storytellerName) {
        html += `<div class="cover-author">As told by ${storytellerName}</div>`;
      }
      if (createdDate) {
        html += `<div class="cover-date">${createdDate}</div>`;
      }
      html += `<div class="cover-footer">Storyteller</div>`;
      html += `</div>`;

      // --- Dedication Page (if gift message) ---
      if (story.giftMessage) {
        pageNum++;
        html += `<div class="page dedication-page">`;
        html += `<div class="dedication-label">Dedication</div>`;
        html += `<div class="dedication-ornament"></div>`;
        html += `<div class="dedication-text">\u201C${story.giftMessage}\u201D</div>`;
        html += `<div class="dedication-ornament"></div>`;
        html += `<div class="page-number">${pageNum}</div>`;
        html += `</div>`;
      }

      // --- Story Text Page (only when there are no pictures; otherwise the
      // story is told under the pictures) ---
      if (illustrationsList.length === 0) {
      pageNum++;
      html += `<div class="page story-page">`;
      html += `<h2>${story.title}</h2>`;
      if (story.era || story.category) {
        html += `<div class="story-meta">${[story.era, story.category].filter(Boolean).join(" \u00B7 ")}</div>`;
      }
      html += `<div class="story-text">`;
      story.content.split("\n").forEach(p => {
        if (p.trim()) html += `<p>${p.trim()}</p>`;
      });
      html += `</div>`;
      html += `<div class="page-number">${pageNum}</div>`;
      html += `</div>`;
      }

      // --- Illustration Pages ---
      for (let i = 0; i < illustrationsList.length; i++) {
        pageNum++;
        const ill = illustrationsList[i];
        const imgSrc = imageToBase64(ill.imageUrl);
        html += `<div class="page illustration-page">`;
        html += `<div class="illustration-image-wrapper"><img src="${imgSrc}" alt="${esc(ill.sceneCaption || `Scene ${i + 1}`)}"></div>`;
        // The words for this picture: what the storyteller wrote for it, or their story's own words.
        const words = ill.customText ? [ill.customText] : (ill as any).pageText ? String((ill as any).pageText).split(/\n+/).filter(Boolean) : passages[i] || [];
        if (words.length) {
          html += `<div class="page-text${i === 0 ? " first" : ""}">${words.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`;
        } else if (ill.sceneCaption) {
          html += `<div class="illustration-caption">${esc(ill.sceneCaption)}</div>`;
        }
        html += `<div class="page-number">${pageNum}</div>`;
        html += `</div>`;
      }

      // --- Colophon / Back Page ---
      pageNum++;
      html += `<div class="page colophon-page">`;
      html += `<div class="colophon-logo">Storyteller</div>`;
      html += `<div class="colophon-tagline">Preserving family stories, one memory at a time</div>`;
      html += `<div class="cover-ornament"></div>`;
      html += `<div class="colophon-info">`;
      html += `This storybook was lovingly created with Storyteller.<br>`;
      if (storytellerName) {
        html += `Storyteller: ${storytellerName}<br>`;
      }
      if (createdDate) {
        html += `Date: ${createdDate}<br>`;
      }
      html += `${illustrationsList.length} illustrated scene${illustrationsList.length !== 1 ? "s" : ""}<br>`;
      html += `</div>`;
      html += `<div class="page-number">${pageNum}</div>`;
      html += `</div>`;

      html += `</div>
<script>
function closeBook() {
  window.close();
  setTimeout(function () { location.href = "/stories/${storyId}"; }, 150);
}
// Fit the A4 pages to the phone's screen (printing still uses full A4).
function fitBook() {
  var book = document.getElementById("book");
  var page = book.querySelector(".page");
  if (!page) return;
  book.style.transform = ""; book.style.width = ""; book.style.height = "";
  var pageW = page.offsetWidth + 40;
  var scale = Math.min(1, window.innerWidth / pageW);
  if (scale < 1) {
    book.style.width = pageW + "px";
    book.style.transform = "scale(" + scale + ")";
    book.style.height = (book.scrollHeight * scale) + "px";
  }
}
window.addEventListener("load", fitBook);
window.addEventListener("resize", fitBook);
window.addEventListener("beforeprint", function () { var b = document.getElementById("book"); b.style.transform = ""; b.style.width = ""; b.style.height = ""; });
window.addEventListener("afterprint", fitBook);
</script>
</body></html>`;

      res.setHeader("Content-Type", "text/html");
      // Open in the browser (not a file download) so it can be read and saved as a PDF.
      res.setHeader("Content-Disposition", `inline; filename="${story.title.replace(/[^a-zA-Z0-9]/g, "_")}_storybook.html"`);
      res.send(html);
    } catch (error) {
      console.error("Error generating PDF:", error);
      res.status(500).json({ error: "Failed to generate download" });
    }
  });

  return httpServer;
}
