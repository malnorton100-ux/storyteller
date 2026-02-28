import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

/**
 * Generate an image and return as Buffer.
 * Uses gpt-image-1 model via Replit AI Integrations.
 */
export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024"
): Promise<Buffer> {
  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
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
 * Uses gpt-image-1 model via Replit AI Integrations.
 */
export async function generateImageWithReference(
  referenceImagePath: string,
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024"
): Promise<Buffer> {
  const imageFile = await toFile(fs.createReadStream(referenceImagePath), referenceImagePath, {
    type: referenceImagePath.endsWith(".jpg") || referenceImagePath.endsWith(".jpeg") ? "image/jpeg" : "image/png",
  });

  const safePrompt = `The attached image is a harmless family portrait reference photo used solely for facial and physical appearance matching. Use it to accurately reproduce this person's facial features, body type, skin tone, and distinguishing features as a character in the following illustrated scene. The character should be dressed appropriately for the setting and activity described. ${prompt}`;

  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: imageFile,
    prompt: safePrompt,
    size,
  } as any);

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

