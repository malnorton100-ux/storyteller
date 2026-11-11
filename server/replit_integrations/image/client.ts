import { openaiConfig, IMAGE_MODEL } from "../../config";
import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";

export const openai = new OpenAI(openaiConfig);

/**
 * Generate an image and return as Buffer.
 * Uses IMAGE_MODEL (see server/config.ts).
 */
/**
 * Added to every picture prompt. Children in these stories are always drawn
 * fully and modestly dressed, whatever the story says.
 */
export const CHILD_SAFE_RULE =
  "SAFETY RULE (overrides everything above): any child or teenager shown is fully and modestly dressed in ordinary, age-appropriate clothing for the activity (e.g. boardshorts with a T-shirt or rash vest at the beach). Never revealing or minimal clothing on a child, and never pose, frame or crop to draw attention to a child's body.";

function withSafety(prompt: string): string {
  return `${prompt}\n\n${CHILD_SAFE_RULE}`;
}

export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024"
): Promise<Buffer> {
  const response = await openai.images.generate({
    model: IMAGE_MODEL,
    prompt: withSafety(prompt),
    size,
    output_format: "png",
  } as any);

  const imageData = response.data?.[0];
  if (!imageData) {
    throw new Error("Image generation returned no data");
  }

  if (imageData.b64_json) {
    return Buffer.from(imageData.b64_json, "base64");
  }

  if (imageData.url) {
    const imgResponse = await fetch(imageData.url);
    if (!imgResponse.ok) {
      throw new Error(`Failed to download generated image: ${imgResponse.status}`);
    }
    const arrayBuffer = await imgResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  throw new Error("Image generation returned neither base64 nor URL");
}

/**
 * Edit/combine multiple images into a composite.
 * Uses IMAGE_MODEL (see server/config.ts).
 */
const asFile = (p: string) =>
  toFile(fs.createReadStream(p), p, { type: p.endsWith(".jpg") || p.endsWith(".jpeg") ? "image/jpeg" : "image/png" });

/**
 * Picture with references. With one path: a face reference. With
 * `styleReferencePath` too: image 1 = face, image 2 = an earlier page of the same
 * storybook (outfit, recurring objects and art style - NOT its pose).
 */
export async function generateImageWithReference(
  referenceImagePath: string,
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024",
  styleReferencePath?: string
): Promise<Buffer> {
  const twoRefs = !!styleReferencePath && fs.existsSync(styleReferencePath) && styleReferencePath !== referenceImagePath;
  const images = twoRefs
    ? [await asFile(referenceImagePath), await asFile(styleReferencePath!)]
    : await asFile(referenceImagePath);

  const safePrompt = twoRefs
    ? `Two harmless family reference images are attached. IMAGE 1 is a portrait of the storyteller: use it for their face, hair, skin tone and build. IMAGE 2 is an earlier page of the same illustrated storybook: match its art style, colour palette, the storyteller's outfit and the look of any recurring objects (vehicles, carts, places), but do NOT copy its pose, composition, framing or camera angle - this is a NEW moment. ${prompt}`
    : `The attached image is a harmless family portrait reference photo used solely for facial and physical appearance matching. Use it to accurately reproduce this person's facial features, body type, skin tone, and distinguishing features as a character in the following illustrated scene. The character should be dressed appropriately for the setting and activity described. ${prompt}`;

  let response: any;
  try {
    response = await openai.images.edit({ model: IMAGE_MODEL, image: images, prompt: withSafety(safePrompt), size } as any);
  } catch (err) {
    if (!twoRefs) throw err;
    console.warn("[Image] Two-reference edit failed, retrying with the face only:", (err as Error).message);
    return generateImageWithReference(referenceImagePath, prompt, size);
  }

  const imageData = response.data?.[0];
  if (!imageData) {
    throw new Error("Image edit returned no data");
  }

  if (imageData.b64_json) {
    return Buffer.from(imageData.b64_json, "base64");
  }

  if (imageData.url) {
    const imgResponse = await fetch(imageData.url);
    if (!imgResponse.ok) {
      throw new Error(`Failed to download generated image: ${imgResponse.status}`);
    }
    const arrayBuffer = await imgResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  throw new Error("Image edit returned neither base64 nor URL");
}

