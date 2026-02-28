import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertStorySchema } from "@shared/schema";
import { openai, ensureCompatibleFormat, speechToText, textToSpeech } from "./replit_integrations/audio/client";
import { generateImageBuffer, generateImageWithReference } from "./replit_integrations/image/client";
import { generateVideoFromScenes } from "./video-generator";
import { isLumaConfigured, setReplicateToken, validateAndFixToken } from "./luma-client";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const illustrationJobs = new Map<string, { status: "generating" | "complete" | "failed" | "cancelled"; totalScenes: number; completedScenes: number; storyId: number; cancelled?: boolean }>();
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
  const coverDir = path.join(process.cwd(), "client", "public", "images", "covers");
  if (!fs.existsSync(coverDir)) fs.mkdirSync(coverDir, { recursive: true });
  const filename = `cover-${storyId}-${Date.now()}.png`;
  const imagePath = path.join(coverDir, filename);
  fs.writeFileSync(imagePath, imageBuffer);

  const coverUrl = `/images/covers/${filename}`;
  await storage.updateStory(storyId, { coverImageUrl: coverUrl });
  console.log(`Cover generated for story ${storyId}: ${coverUrl}`);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(express.json({ limit: "50mb" }));

  app.get("/api/stories", async (_req, res) => {
    try {
      const stories = await storage.getStories();
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
      const story = await storage.createStory(parsed);
      res.status(201).json(story);

      if (story.content && story.content.length > 30) {
        generateCoverForStory(story.id, story.title, story.content).catch(err =>
          console.error(`Background cover generation failed for story ${story.id}:`, err)
        );
      }
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

      await generateCoverForStory(id, story.title, story.content);
      const updated = await storage.getStory(id);
      res.json(updated);
    } catch (error) {
      console.error("Error generating cover:", error);
      res.status(500).json({ error: "Failed to generate cover image" });
    }
  });

  app.post("/api/stories/generate-covers", async (_req, res) => {
    try {
      const stories = await storage.getStories();
      const needsCover = stories.filter(s => !s.coverImageUrl && s.content.length > 30);
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
    try {
      const storyId = parseInt(req.params.id);
      const { style, profileId, sceneCount: rawSceneCount } = req.body;
      const sceneCount = Math.min(Math.max(parseInt(rawSceneCount) || 4, 2), 8);

      const story = await storage.getStory(storyId);
      if (!story) return res.status(404).json({ error: "Story not found" });

      let profile: any = null;
      if (profileId) {
        profile = await storage.getStorytellerProfile(profileId);
      } else {
        const profiles = await storage.getStorytellerProfiles();
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
        model: "gpt-5.2",
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
    "outfit": "one SPECIFIC outfit appropriate for the activity and era — name exact colors and garments, e.g. 'faded blue singlet, tan shorts, brown leather sandals'"
  },
  "otherCharacters": ["dad (adult, 30s)", "friend (same age as storyteller)"],
  "setting": "brief setting/location"
}`
          },
          { role: "user", content: storyText }
        ],
        max_completion_tokens: 500,
      });

      let charInfo: any = null;
      try {
        const rawChar = characterAnalysis.choices[0]?.message?.content || "{}";
        const cleanedChar = rawChar.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        charInfo = JSON.parse(cleanedChar);
        console.log("[Illustrations] Character analysis:", JSON.stringify(charInfo, null, 2));
      } catch (e) {
        console.warn("[Illustrations] Character analysis parse failed, using defaults");
      }

      const storytellerDesc = charInfo?.storyteller?.description || (isChildStory ? "a young child with same ethnicity and skin tone as reference photo" : "the main character matching the reference photo");
      const storytellerAge = charInfo?.storyteller?.ageInStory || (isChildStory ? "about 10 years old" : "");
      const storytellerOutfit = charInfo?.storyteller?.outfit || "";
      const storytellerIsChild = charInfo?.storyteller?.isChild ?? isChildStory;
      const otherCharsSimple = Array.isArray(charInfo?.otherCharacters) ? charInfo.otherCharacters.join(", ") : "";

      const sceneSplitResponse = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You break personal stories into exactly ${sceneCount} key visual scenes. Spread the story evenly across all ${sceneCount} scenes.

For each scene, output a short caption (10 words max) and a detailed visual description (2-3 sentences).

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
1. Write [STORYTELLER] after the storyteller character in every scene description so the image AI knows who they are.
2. In EVERY scene, repeat the storyteller's EXACT physical description: their height, body build, face shape, skin tone, hair color/style, and outfit. Copy-paste level consistency.
3. The storyteller is EXACTLY ${storytellerAge} in ALL scenes — their body size and proportions NEVER change. ${storytellerIsChild ? `A ${storytellerAge} child is SMALL — shorter than adults, thin limbs, round face. They do NOT grow taller or more muscular in later scenes.` : ""}
4. Same outfit in every scene: ${storytellerOutfit || "as described above"}.
5. Other characters just need their role mentioned (e.g. "his dad" or "her friend") — don't over-describe them. NEVER describe an adult character with the storyteller's features.
6. Only TWO characters maximum per scene when possible. Avoid extra background figures.

Respond in valid JSON format ONLY:
[
  ${Array.from({ length: sceneCount }, () => '{"caption": "...", "description": "..."}').join(",\n  ")}
]`
          },
          { role: "user", content: storyText }
        ],
        max_completion_tokens: sceneCount <= 4 ? 1000 : 3000,
      });

      let scenes: { caption: string; description: string }[] = [];
      try {
        const rawContent = sceneSplitResponse.choices[0]?.message?.content || "[]";
        const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Invalid scenes");
        scenes = parsed;
        console.log(`[Illustrations] Requested ${sceneCount} scenes, AI generated ${scenes.length} scenes`);
      } catch (parseErr) {
        console.error(`[Illustrations] Failed to parse scene JSON, using fallback for ${sceneCount} scenes`);
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

      const jobId = `ill-${storyId}-${Date.now()}`;
      illustrationJobs.set(jobId, { status: "generating", totalScenes: scenes.length, completedScenes: 0, storyId });

      res.status(202).json({ status: "generating", totalScenes: scenes.length, storyId, jobId });

      const profilePhotoPath = profile?.photoUrl ? path.join(process.cwd(), "client", "public", profile.photoUrl) : null;
      const illDir = path.join(process.cwd(), "client", "public", "images", "illustrations");
      if (!fs.existsSync(illDir)) fs.mkdirSync(illDir, { recursive: true });

      let completedCount = 0;
      let consistencyRefPath: string | null = null;
      let ageTransformedRefPath: string | null = null;

      if (storytellerIsChild && profilePhotoPath && fs.existsSync(profilePhotoPath)) {
        const ageTransformPrompt = `This is a photo of a real person. Generate a portrait of this SAME person but as a ${storytellerAge || "young teenager"}. Keep their EXACT same face — same eyes, same nose, same face shape, same skin tone, same ethnicity. Just make them younger: smooth skin, no wrinkles, full thick ${storytellerDesc.includes("dark") ? "dark" : "natural-colored"} hair, youthful features. Same person, just younger. Head and shoulders portrait, neutral background.`;
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

      if (effectiveRefPath && fs.existsSync(effectiveRefPath)) {
        const scene0 = scenes[0];
        const charGuide = storytellerIsChild
          ? `The reference image shows the storyteller [STORYTELLER] at ${storytellerAge}. Draw them EXACTLY as they appear in the reference — same face, same hair, same build. Outfit: ${storytellerOutfit}. They are the STAR — the largest, most prominent figure. Any adult (parent, etc.) is a DIFFERENT person who must NOT resemble the reference.`
          : `THE STORYTELLER [STORYTELLER]: ${storytellerDesc}. Age: ${storytellerAge}. Outfit: ${storytellerOutfit}. Apply the reference photo to THIS character. They are the STAR — make them the focal point.`;
        const childNote = storytellerIsChild ? `The storyteller is ${storytellerAge} — draw them as a child/teen exactly matching the reference portrait. ` : "";
        const prompt0 = `Illustrate this personal memory scene: "${scene0.description}". ${charGuide} ${childNote}${appearanceInstruction}${styleInstruction} No text or words in the image. Make it warm, emotional, and nostalgic.`;

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
        const sceneCharGuide = storytellerIsChild
          ? `The reference image shows the storyteller [STORYTELLER] as a child/teen. Match them EXACTLY — same face, same hair, same body size, same outfit (${storytellerOutfit}). Age: ${storytellerAge}. They must look identical across all scenes. Any adults are DIFFERENT people.`
          : `THE STORYTELLER [STORYTELLER]: ${storytellerDesc}. Age: ${storytellerAge}. Outfit: ${storytellerOutfit}. Must look IDENTICAL to the person in the reference image. They are the STAR.`;
        const prompt = `Illustrate this personal memory scene: "${scene.description}". ${sceneCharGuide} ${appearanceInstruction}${styleInstruction} No text or words in the image. Make it warm, emotional, and nostalgic.`;

        let imageBuffer: Buffer;
        if (consistencyRefPath && fs.existsSync(consistencyRefPath)) {
          try {
            imageBuffer = await generateImageWithReference(consistencyRefPath, prompt, "1024x1024");
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
          sceneOrder: i + 1,
        });
        completedCount++;
        illustrationJobs.set(jobId, { ...illustrationJobs.get(jobId)!, status: "generating", completedScenes: completedCount });
        return true;
      }, 3);

      completedCount = (consistencyRefPath ? 1 : 0) + results.filter(r => r !== null).length;

      const finalJob = illustrationJobs.get(jobId);
      const wasCancelled = finalJob?.cancelled;
      illustrationJobs.set(jobId, { status: wasCancelled ? "cancelled" : (completedCount > 0 ? "complete" : "failed"), totalScenes: scenes.length, completedScenes: completedCount, storyId, cancelled: wasCancelled });
      setTimeout(() => illustrationJobs.delete(jobId), 300000);

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
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate illustrations" });
      }
    }
  });

  app.get("/api/illustration-jobs/:jobId", (req, res) => {
    const job = illustrationJobs.get(req.params.jobId);
    if (!job) return res.json({ status: "complete", totalScenes: 0, completedScenes: 0 });
    res.json(job);
  });

  app.post("/api/illustration-jobs/:jobId/cancel", (req, res) => {
    const job = illustrationJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
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
        model: "gpt-5.2",
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
        max_completion_tokens: 2048,
      });

      const enhanced = response.choices[0]?.message?.content || content;
      res.json({ enhanced });
    } catch (error) {
      console.error("Error enhancing story:", error);
      res.status(500).json({ error: "Failed to enhance story" });
    }
  });

  app.get("/api/video-config", (_req, res) => {
    res.json({
      aiVideoEnabled: isLumaConfigured(),
      mode: isLumaConfigured() ? "ai-video" : "ken-burns",
    });
  });

  app.post("/api/set-replicate-token", (req, res) => {
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
    try {
      const storyId = parseInt(req.params.id);
      const { style, profileId, enableNarration } = req.body;

      const story = await storage.getStory(storyId);
      if (!story) return res.status(404).json({ error: "Story not found" });

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
      } else {
        const profiles = await storage.getStorytellerProfiles();
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

      const videoProfilePhotoPath = videoProfile?.photoUrl ? path.join(process.cwd(), "client", "public", videoProfile.photoUrl) : null;
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

          const videoCharAnalysis = await openai.chat.completions.create({
            model: "gpt-5.2",
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
    "outfit": "one SPECIFIC outfit — exact colors and garments"
  },
  "otherCharacters": ["dad (adult, 30s)", "friend (same age)"],
  "setting": "brief setting"
}`
              },
              { role: "user", content: videoStoryText }
            ],
            max_completion_tokens: 500,
          });

          let vidCharInfo: any = null;
          try {
            const rawVidChar = videoCharAnalysis.choices[0]?.message?.content || "{}";
            const cleanedVidChar = rawVidChar.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
            vidCharInfo = JSON.parse(cleanedVidChar);
            console.log("[Video] Character analysis:", JSON.stringify(vidCharInfo, null, 2));
          } catch {
            console.warn("[Video] Character analysis parse failed, using defaults");
          }

          const vidStorytellerDesc = vidCharInfo?.storyteller?.description || (videoIsChildStory ? "a young child with same ethnicity as reference" : "the main character matching reference photo");
          const vidStorytellerAge = vidCharInfo?.storyteller?.ageInStory || (videoIsChildStory ? "about 10 years old" : "");
          const vidStorytellerOutfit = vidCharInfo?.storyteller?.outfit || "";
          const vidStorytellerIsChild = vidCharInfo?.storyteller?.isChild ?? videoIsChildStory;
          const vidOtherCharsSimple = Array.isArray(vidCharInfo?.otherCharacters) ? vidCharInfo.otherCharacters.join(", ") : "";

          const sceneResponse = await openai.chat.completions.create({
            model: "gpt-5.2",
            messages: [
              {
                role: "system",
                content: `You break personal stories into 4 vivid visual scenes for an AI-generated VIDEO with REAL MOTION. Each scene will be animated into a video clip.

For each scene, provide:
1. A detailed image generation prompt showing a MOMENT OF ACTION — character mid-gesture, mid-step. Describe active pose, clothing, environment with movable elements, camera angle, and lighting.
2. A short caption (1-2 sentences narrating this moment)

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

${videoContentRating === "M" ? "CONTENT: Mature — include dramatic tension, realistic body exposure for activity." : videoContentRating === "PG" ? "CONTENT: PG — tone down graphic violence but keep emotional weight." : "CONTENT: G — fully family-friendly, no violence or danger."}

Return ONLY valid JSON array: [{"prompt": "...", "caption": "..."}, ...]`
              },
              {
                role: "user",
                content: `Break this story into 4 ACTION-RICH scenes ${styleInstruction}:\n\n${videoStoryText}`
              }
            ],
            max_completion_tokens: 2000,
          });

          const rawScenes = sceneResponse.choices[0]?.message?.content || "[]";
          let scenesParsed: { prompt: string; caption: string }[];
          try {
            const cleaned = rawScenes.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(cleaned);
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
          const illDir = path.join(process.cwd(), "client", "public", "images", "illustrations");
          if (!fs.existsSync(illDir)) {
            fs.mkdirSync(illDir, { recursive: true });
          }

          let videoConsistencyRefPath: string | null = null;
          let videoAgeTransformedRefPath: string | null = null;

          if (vidStorytellerIsChild && hasReferencePhoto) {
            const vidAgePrompt = `This is a photo of a real person. Generate a portrait of this SAME person but as a ${vidStorytellerAge || "young teenager"}. Keep their EXACT same face — same eyes, same nose, same face shape, same skin tone, same ethnicity. Just make them younger: smooth skin, no wrinkles, full thick hair, youthful features. Same person, just younger. Head and shoulders portrait, neutral background.`;
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
              ? `The reference image shows the storyteller [STORYTELLER] at ${vidStorytellerAge}. Draw them EXACTLY as they appear in the reference — same face, same hair, same build. Outfit: ${vidStorytellerOutfit}. They are the STAR — the largest, most prominent figure. Any adult is a DIFFERENT person who must NOT resemble the reference.`
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
              sceneImages[0] = { imagePath: fp0, caption: scene0.caption };
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
              ? `The reference image shows the storyteller [STORYTELLER] as a child/teen. Match them EXACTLY — same face, same hair, same body size, same outfit (${vidStorytellerOutfit}). Age: ${vidStorytellerAge}. They must look identical across all scenes. Any adults are DIFFERENT people.`
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

            sceneImages[i] = { imagePath, caption: scene.caption };
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

          const validSceneImages = sceneImages.filter((s): s is { imagePath: string; caption: string } => s !== undefined);
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

          let narrationConfig = undefined;
          if (enableNarration && videoProfile) {
            const voice = videoProfile.voicePreference as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" | null;
            if (voice) {
              narrationConfig = {
                enabled: true,
                voice,
                voiceSampleUrl: videoProfile.voiceSampleUrl || null,
              };
              console.log(`[VideoGen] Narration enabled with voice: ${voice}`);
            }
          }

          const videoUrl = await generateVideoFromScenes(validSceneImages, videoFilename, story.title, narrationConfig);

          await storage.updateStoryVideo(video.id, {
            storyId,
            style,
            status: "complete",
            videoUrl,
            scenes: validScenes,
          });
        } catch (err: any) {
          const errorMessage = err?.message || "Unknown error";
          console.error("Video generation failed:", errorMessage);
          await storage.updateStoryVideo(video.id, {
            storyId,
            style,
            status: "failed",
            scenes: [],
          });
        }
      })();
    } catch (error) {
      console.error("Error creating video:", error);
      res.status(500).json({ error: "Failed to start video generation" });
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
      await storage.deleteStoryVideo(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting video:", error);
      res.status(500).json({ error: "Failed to delete video" });
    }
  });

  app.get("/api/storyteller-profiles", async (_req, res) => {
    try {
      const profiles = await storage.getStorytellerProfiles();
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
        model: "gpt-5.2",
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
        max_completion_tokens: 700,
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
        const photoDir = path.join(process.cwd(), "client", "public", "images", "profiles");
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
        const mainPath = path.join(process.cwd(), "client", "public", profile.photoUrl);
        if (fs.existsSync(mainPath)) {
          allPhotos.push({ base64: fs.readFileSync(mainPath).toString("base64"), url: profile.photoUrl });
        }
      }
      if (profile.additionalPhotos) {
        for (const url of profile.additionalPhotos) {
          const p = path.join(process.cwd(), "client", "public", url);
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
        const photoDir = path.join(process.cwd(), "client", "public", "images", "profiles");
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
            const filePath = path.join(process.cwd(), "client", "public", additionalUrl);
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
      const photoDir = path.join(process.cwd(), "client", "public", "images", "profiles");
      if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
      fs.writeFileSync(path.join(photoDir, filename), photoBuffer);
      const newPhotoUrl = `/images/profiles/${filename}`;

      const currentAdditional = profile.additionalPhotos || [];
      const updatedAdditional = [...currentAdditional, newPhotoUrl];

      const allPhotos: { base64: string; url: string }[] = [];
      if (profile.photoUrl) {
        const mainPath = path.join(process.cwd(), "client", "public", profile.photoUrl);
        if (fs.existsSync(mainPath)) {
          allPhotos.push({ base64: fs.readFileSync(mainPath).toString("base64"), url: profile.photoUrl });
        }
      }
      for (const url of updatedAdditional) {
        const filePath = path.join(process.cwd(), "client", "public", url);
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
        const mainPath = path.join(process.cwd(), "client", "public", profile.photoUrl);
        if (fs.existsSync(mainPath)) {
          allPhotos.push({ base64: fs.readFileSync(mainPath).toString("base64"), url: profile.photoUrl });
        }
      }
      for (const url of updatedAdditional) {
        const filePath = path.join(process.cwd(), "client", "public", url);
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
        const audioDir = path.join(process.cwd(), "client", "public", "audio", "voice-samples");
        if (!fs.existsSync(audioDir)) {
          fs.mkdirSync(audioDir, { recursive: true });
        }
        const filename = `voice-${id}-${Date.now()}.webm`;
        const audioPath = path.join(audioDir, filename);
        fs.writeFileSync(audioPath, audioBuffer);
        updates.voiceSampleUrl = `/audio/voice-samples/${filename}`;
      }

      if (voiceSample === null) {
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
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: "Generate a short, warm, evocative title for this personal story/memory. The title should be 3-8 words. Return ONLY the title, nothing else."
          },
          { role: "user", content: content.substring(0, 500) }
        ],
        max_completion_tokens: 50,
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
      const { priceId, storyId, productType, sessionId } = req.body;
      if (!priceId || !storyId || !productType || !sessionId) {
        return res.status(400).json({ error: "Missing required fields" });
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
      const { sessionId: stripeSessionId, browserSessionId } = req.body;
      if (!stripeSessionId) {
        return res.status(400).json({ error: "Missing session ID" });
      }

      const purchase = await storage.getPurchaseByStripeSession(stripeSessionId);
      if (!purchase) {
        return res.status(404).json({ error: "Purchase not found" });
      }

      if (browserSessionId && purchase.sessionId !== browserSessionId) {
        return res.status(403).json({ error: "Session mismatch" });
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
      const sessionId = req.query.sessionId as string;
      if (!sessionId) return res.json([]);

      const purchasesList = await storage.getPurchasesForStory(sessionId, storyId);
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
      const sessionId = req.query.sessionId as string;
      if (!sessionId) return res.status(401).json({ error: "Not authorized" });

      const purchasesList = await storage.getPurchasesForStory(sessionId, storyId);
      const hasPdf = purchasesList.some(p => p.productType === "pdf_download" || p.productType === "bundle_download");
      if (!hasPdf) return res.status(403).json({ error: "Purchase required" });

      const story = await storage.getStory(storyId);
      if (!story) return res.status(404).json({ error: "Story not found" });

      const illustrationsList = await storage.getIllustrations(storyId);

      const profiles = await storage.getStorytellerProfiles();
      const storytellerName = profiles.length > 0 ? profiles[0].name : "";

      const imageToBase64 = (relUrl: string): string => {
        try {
          const filePath = path.join(process.cwd(), "client", "public", relUrl);
          if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath);
            const ext = path.extname(filePath).replace(".", "").toLowerCase();
            const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : "image/png";
            return `data:${mime};base64,${data.toString("base64")}`;
          }
        } catch {}
        return relUrl;
      };

      const createdDate = story.createdAt ? new Date(story.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "";

      const totalPages = 1 + (story.giftMessage ? 1 : 0) + 1 + illustrationsList.length + 1;

      let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
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

@media print {
  body { background: white; }
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
<body>`;

      let pageNum = 0;

      // --- Cover Page ---
      pageNum++;
      html += `<div class="page cover-page">`;
      if (story.coverImageUrl) {
        html += `<div class="cover-image-wrapper"><img src="${imageToBase64(story.coverImageUrl)}" alt="Cover"></div>`;
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

      // --- Story Text Page ---
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

      // --- Illustration Pages ---
      for (let i = 0; i < illustrationsList.length; i++) {
        pageNum++;
        const ill = illustrationsList[i];
        const imgSrc = imageToBase64(ill.imageUrl);
        html += `<div class="page illustration-page">`;
        html += `<div class="illustration-scene-label">Scene ${i + 1} of ${illustrationsList.length}</div>`;
        html += `<div class="illustration-image-wrapper"><img src="${imgSrc}" alt="${ill.sceneCaption || `Scene ${i + 1}`}"></div>`;
        if (ill.sceneCaption) {
          html += `<div class="illustration-caption">${ill.sceneCaption}</div>`;
        }
        if (ill.customText) {
          html += `<div class="illustration-custom-text">${ill.customText}</div>`;
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

      html += `</body></html>`;

      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Disposition", `attachment; filename="${story.title.replace(/[^a-zA-Z0-9]/g, "_")}_storybook.html"`);
      res.send(html);
    } catch (error) {
      console.error("Error generating PDF:", error);
      res.status(500).json({ error: "Failed to generate download" });
    }
  });

  return httpServer;
}
