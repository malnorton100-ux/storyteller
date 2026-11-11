import fs from "fs";
import path from "path";
import { pool } from "./db";
import { PUBLIC_DATA_DIR, PRIVATE_DATA_DIR } from "./config";

/**
 * Voice recordings are private: they live outside the public folder and are only
 * played through /api/storyteller-profiles/:id/voice-sample, which checks the owner.
 * (A voice can now be copied by AI, so the files must never be downloadable by link.)
 */
export const VOICE_DIR = path.join(PRIVATE_DATA_DIR, "voice-samples");

/** The address stored on the profile (and used by the app to play it). */
export function voiceSampleUrlFor(profileId: number, filename: string): string {
  return `/api/storyteller-profiles/${profileId}/voice-sample?f=${encodeURIComponent(filename)}`;
}

/** Where the recording file actually is, for any stored address (new private or old public). */
export function voiceSamplePath(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?&]f=([^&]+)/);
  if (m) {
    const name = path.basename(decodeURIComponent(m[1]));
    return path.join(VOICE_DIR, name);
  }
  return path.join(PUBLIC_DATA_DIR, url.replace(/^\/+/, ""));
}

/** One-off on start-up: move any old public recordings into the private folder. */
export async function moveVoiceSamplesPrivate() {
  try {
    fs.mkdirSync(VOICE_DIR, { recursive: true });
    const r = await pool.query(
      `SELECT id, voice_sample_url FROM storyteller_profiles WHERE voice_sample_url LIKE '/audio/voice-samples/%'`
    );
    for (const row of r.rows) {
      const oldPath = path.join(PUBLIC_DATA_DIR, String(row.voice_sample_url).replace(/^\/+/, ""));
      const name = path.basename(oldPath);
      const newPath = path.join(VOICE_DIR, name);
      if (fs.existsSync(oldPath)) {
        fs.copyFileSync(oldPath, newPath);
        fs.unlinkSync(oldPath);
      }
      if (fs.existsSync(newPath)) {
        await pool.query(`UPDATE storyteller_profiles SET voice_sample_url = $1 WHERE id = $2`, [voiceSampleUrlFor(row.id, name), row.id]);
      }
    }
    if (r.rows.length) console.log(`[Voice] Moved ${r.rows.length} voice recording(s) to private storage`);
  } catch (err: any) {
    console.warn("[Voice] Could not move old recordings:", err.message);
  }
}
