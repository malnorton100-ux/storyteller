import fs from "fs";
import path from "path";
import crypto from "crypto";
import { pool } from "./db";
import { PUBLIC_DATA_DIR, PRIVATE_DATA_DIR } from "./config";
import { voiceSamplePath } from "./voice-samples";

/**
 * "Delete my account": removes the person, their stories, pictures, movies,
 * photos, voice recording and voice narrations.
 *
 * The only thing kept is a one-way scrambled (hashed) copy of the email with
 * whether the free storybook / tester stories were used. That way nobody can
 * delete and sign up again to get endless free AI stories. It can't be turned
 * back into the email. Payment records stay with Stripe (needed for tax).
 */

export const NARRATION_CACHE_DIR = path.join(PRIVATE_DATA_DIR, "narration-cache");

/** Short id for a voice recording, put at the front of its narration cache files. */
export function voiceCachePrefix(voiceSampleUrl: string): string {
  return crypto.createHash("sha1").update(voiceSampleUrl).digest("hex").slice(0, 12);
}

function emailHash(email: string): string {
  return crypto.createHash("sha256").update("storyteller|" + email.trim().toLowerCase()).digest("hex");
}

export async function ensureDeleteAccountSchema() {
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS deleted_accounts (
         email_hash text PRIMARY KEY,
         free_storybook_used boolean NOT NULL DEFAULT false,
         tester boolean NOT NULL DEFAULT false,
         tester_stories_used integer NOT NULL DEFAULT 0,
         deleted_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP)`
    );
  } catch (err: any) {
    console.warn(`[delete-account] Schema step skipped: ${err.message}`);
  }
}

/** On sign-up: if this email deleted an account before, don't hand out the free stuff again. */
export async function restoreUsedFreebies(uid: string, email: string) {
  try {
    const r = await pool.query(`SELECT * FROM deleted_accounts WHERE email_hash = $1`, [emailHash(email)]);
    const row = r.rows[0];
    if (!row) return;
    await pool.query(
      `UPDATE users SET free_storybook_used = free_storybook_used OR $2,
                        tester = tester OR $3,
                        tester_stories_used = GREATEST(tester_stories_used, $4)
        WHERE id = $1`,
      [uid, row.free_storybook_used, row.tester, row.tester_stories_used]
    );
  } catch (err: any) {
    console.warn(`[delete-account] Could not check earlier account: ${err.message}`);
  }
}

/** Turn a stored file address (/images/..., /videos/...) into a file path, only inside our own folders. */
function publicFile(url: string | null | undefined): string | null {
  if (!url || /^https?:/i.test(url)) return null;
  const clean = url.split("?")[0].replace(/^\/+/, "");
  if (!/^(images|videos)\//.test(clean)) return null; // never touch app/showcase files
  const full = path.resolve(PUBLIC_DATA_DIR, clean);
  return full.startsWith(path.resolve(PUBLIC_DATA_DIR) + path.sep) ? full : null;
}

function removeFile(p: string | null) {
  if (!p) return false;
  try {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      return true;
    }
  } catch (err: any) {
    console.warn(`[delete-account] Could not remove ${p}: ${err.message}`);
  }
  return false;
}

/** Deletes everything belonging to this user. Returns how many files were removed. */
export async function deleteAccount(uid: string): Promise<number> {
  const userRow = (await pool.query(
    `SELECT username, free_storybook_used, tester, tester_stories_used FROM users WHERE id = $1`,
    [uid]
  )).rows[0];
  if (!userRow) return 0;

  // 1. Gather every file address before the database rows go.
  const files = new Set<string>();
  const voices: string[] = [];
  const add = (u: any) => { const p = publicFile(u); if (p) files.add(p); };

  const stories = await pool.query(`SELECT id, cover_image_url FROM stories WHERE user_id = $1`, [uid]);
  const storyIds = stories.rows.map((s) => s.id);
  stories.rows.forEach((s) => add(s.cover_image_url));
  if (storyIds.length) {
    const ills = await pool.query(`SELECT image_url FROM illustrations WHERE story_id = ANY($1::int[])`, [storyIds]);
    ills.rows.forEach((i) => add(i.image_url));
    const vids = await pool.query(`SELECT video_url, scenes FROM story_videos WHERE story_id = ANY($1::int[])`, [storyIds]);
    vids.rows.forEach((v) => {
      add(v.video_url);
      (Array.isArray(v.scenes) ? v.scenes : []).forEach((sc: any) => add(sc?.imageUrl));
    });
  }
  const profiles = await pool.query(
    `SELECT photo_url, additional_photos, voice_sample_url FROM storyteller_profiles WHERE user_id = $1`,
    [uid]
  );
  profiles.rows.forEach((p) => {
    add(p.photo_url);
    (p.additional_photos || []).forEach(add);
    if (p.voice_sample_url) voices.push(p.voice_sample_url);
  });

  // 2. Remember (scrambled) that the freebies were used, then delete the account.
  //    Stories, pictures, movies, profiles and reset links go with it (ON DELETE CASCADE).
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO deleted_accounts (email_hash, free_storybook_used, tester, tester_stories_used)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email_hash) DO UPDATE SET
         free_storybook_used = deleted_accounts.free_storybook_used OR EXCLUDED.free_storybook_used,
         tester = deleted_accounts.tester OR EXCLUDED.tester,
         tester_stories_used = GREATEST(deleted_accounts.tester_stories_used, EXCLUDED.tester_stories_used),
         deleted_at = CURRENT_TIMESTAMP`,
      [emailHash(userRow.username), !!userRow.free_storybook_used, !!userRow.tester, Number(userRow.tester_stories_used) || 0]
    );
    await client.query(`DELETE FROM users WHERE id = $1`, [uid]);
    // Log them out everywhere (phone, tablet...).
    await client.query(`DELETE FROM "session" WHERE sess->>'userId' = $1`, [uid]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // 3. Remove the files (after the database, so a failure here never leaves a half-deleted account).
  let removed = 0;
  for (const f of files) if (removeFile(f)) removed++;
  for (const v of voices) {
    if (removeFile(voiceSamplePath(v))) removed++;
    const prefix = voiceCachePrefix(v) + "-";
    try {
      for (const name of fs.readdirSync(NARRATION_CACHE_DIR)) {
        if (name.startsWith(prefix) && removeFile(path.join(NARRATION_CACHE_DIR, name))) removed++;
      }
    } catch {}
  }
  return removed;
}

/**
 * Start-up tidy: own-voice narration clips are only a speed-up cache, so drop
 * any older than 30 days (this also clears clips made before they were labelled
 * by voice, so deleted voices never hang around).
 */
export function cleanOldNarrationCache() {
  try {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let n = 0;
    for (const name of fs.readdirSync(NARRATION_CACHE_DIR)) {
      const p = path.join(NARRATION_CACHE_DIR, name);
      if (fs.statSync(p).mtimeMs < cutoff) { fs.rmSync(p, { force: true }); n++; }
    }
    if (n) console.log(`[Voice] Removed ${n} old narration clip(s)`);
  } catch {}
}
