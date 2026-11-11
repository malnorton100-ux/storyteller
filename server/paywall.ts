import type { Request, Response, NextFunction } from "express";
import { pool } from "./db";
import { storage } from "./storage";
import { isOwner, userId } from "./auth";

/**
 * Who pays for the AI.
 * - Every new account gets ONE free 2-page storybook (the hook).
 * - After that, more pictures need a purchase on that story (any product).
 * - Making a movie needs the Movie or Bundle purchase on that story.
 * - Each purchase allows a few goes (remakes), so one payment can't run up
 *   unlimited AI bills. Buying again adds more goes.
 * - The app owner (ADMIN_EMAIL) is never limited.
 */
export const FREE_PICTURES = 2;
export const PICTURE_RUNS_PER_PURCHASE = Number(process.env.PICTURE_RUNS_PER_PURCHASE || 3);
export const MOVIE_RUNS_PER_PURCHASE = Number(process.env.MOVIE_RUNS_PER_PURCHASE || 2);
/** Cheap text/voice AI calls (transcribe, story helper, titles...) per account per day. */
export const DAILY_TEXT_AI_LIMIT = Number(process.env.DAILY_TEXT_AI_LIMIT || 150);

const MOVIE_TYPES = ["video_download", "bundle_download"];

export async function ensurePaywallSchema() {
  const statements = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS free_storybook_used boolean NOT NULL DEFAULT false`,
    `ALTER TABLE stories ADD COLUMN IF NOT EXISTS picture_runs integer NOT NULL DEFAULT 0`,
    `ALTER TABLE stories ADD COLUMN IF NOT EXISTS movie_runs integer NOT NULL DEFAULT 0`,
    // Anyone who already has pictures has had their free storybook.
    `UPDATE users SET free_storybook_used = true WHERE free_storybook_used = false AND id IN (
       SELECT DISTINCT s.user_id FROM stories s JOIN illustrations i ON i.story_id = s.id WHERE s.user_id IS NOT NULL)`,
  ];
  for (const sql of statements) {
    try {
      await pool.query(sql);
    } catch (err: any) {
      console.warn(`[paywall] Schema step skipped: ${err.message}`);
    }
  }
}

async function paidPurchases(req: Request, storyId: number) {
  const list = await storage.getPurchasesForStory(userId(req), storyId);
  return {
    any: list.length,
    movie: list.filter((p) => MOVIE_TYPES.includes(p.productType)).length,
  };
}

async function storyRuns(storyId: number): Promise<{ picture_runs: number; movie_runs: number }> {
  const r = await pool.query(`SELECT picture_runs, movie_runs FROM stories WHERE id = $1`, [storyId]);
  return r.rows[0] || { picture_runs: 0, movie_runs: 0 };
}

async function freeAvailable(uid: string): Promise<boolean> {
  const r = await pool.query(`SELECT free_storybook_used FROM users WHERE id = $1`, [uid]);
  return r.rows[0] ? !r.rows[0].free_storybook_used : false;
}

/** What this person can still make for this story - shown in the app. */
export async function getAllowance(req: Request, storyId: number) {
  if (await isOwner(req)) {
    return { owner: true, freeStorybook: true, picturesUnlocked: true, movieUnlocked: true, pictureRunsLeft: 999, movieRunsLeft: 999 };
  }
  const paid = await paidPurchases(req, storyId);
  const runs = await storyRuns(storyId);
  return {
    owner: false,
    freeStorybook: await freeAvailable(userId(req)),
    picturesUnlocked: paid.any > 0,
    movieUnlocked: paid.movie > 0,
    pictureRunsLeft: Math.max(0, paid.any * PICTURE_RUNS_PER_PURCHASE - runs.picture_runs),
    movieRunsLeft: Math.max(0, paid.movie * MOVIE_RUNS_PER_PURCHASE - runs.movie_runs),
  };
}

type Claim =
  | { ok: true; kind: "owner" | "free" | "paid"; maxScenes?: number; refund: () => Promise<void> }
  | { ok: false; status: 402; body: { error: string; reason: "locked" | "used_up"; needs: "pictures" | "movie" } };

const noRefund = async () => {};

/** Take one go at making pictures for this story, or say why not. */
export async function claimPictureRun(req: Request, storyId: number): Promise<Claim> {
  if (await isOwner(req)) return { ok: true, kind: "owner", refund: noRefund };
  const paid = await paidPurchases(req, storyId);

  if (paid.any > 0) {
    const r = await pool.query(
      `UPDATE stories SET picture_runs = picture_runs + 1 WHERE id = $1 AND picture_runs < $2 RETURNING id`,
      [storyId, paid.any * PICTURE_RUNS_PER_PURCHASE]
    );
    if (r.rowCount) {
      return {
        ok: true,
        kind: "paid",
        refund: async () => { await pool.query(`UPDATE stories SET picture_runs = GREATEST(picture_runs - 1, 0) WHERE id = $1`, [storyId]); },
      };
    }
    return { ok: false, status: 402, body: { error: "You've used all the picture remakes for this story. Unlock it again for more.", reason: "used_up", needs: "pictures" } };
  }

  const uid = userId(req);
  const r = await pool.query(
    `UPDATE users SET free_storybook_used = true WHERE id = $1 AND free_storybook_used = false RETURNING id`,
    [uid]
  );
  if (r.rowCount) {
    return {
      ok: true,
      kind: "free",
      maxScenes: FREE_PICTURES,
      refund: async () => { await pool.query(`UPDATE users SET free_storybook_used = false WHERE id = $1`, [uid]); },
    };
  }
  return { ok: false, status: 402, body: { error: "Your free storybook has been used. Unlock this story to make pictures.", reason: "locked", needs: "pictures" } };
}

/** Take one go at making a movie for this story, or say why not. */
export async function claimMovieRun(req: Request, storyId: number): Promise<Claim> {
  if (await isOwner(req)) return { ok: true, kind: "owner", refund: noRefund };
  const paid = await paidPurchases(req, storyId);
  if (paid.movie === 0) {
    return { ok: false, status: 402, body: { error: "Unlock the movie for this story to make it.", reason: "locked", needs: "movie" } };
  }
  const r = await pool.query(
    `UPDATE stories SET movie_runs = movie_runs + 1 WHERE id = $1 AND movie_runs < $2 RETURNING id`,
    [storyId, paid.movie * MOVIE_RUNS_PER_PURCHASE]
  );
  if (r.rowCount) {
    return {
      ok: true,
      kind: "paid",
      refund: async () => { await pool.query(`UPDATE stories SET movie_runs = GREATEST(movie_runs - 1, 0) WHERE id = $1`, [storyId]); },
    };
  }
  return { ok: false, status: 402, body: { error: "You've used all the movie remakes for this story. Unlock it again for more.", reason: "used_up", needs: "movie" } };
}

/** True if this story may have an AI-painted cover (owner, or a paid story). */
export async function mayPaintCover(req: Request, storyId: number): Promise<boolean> {
  if (await isOwner(req)) return true;
  return (await paidPurchases(req, storyId)).any > 0;
}

// Simple daily brake on the cheap AI calls (in memory - resets on redeploy, which is fine).
const textUse = new Map<string, { day: string; count: number }>();
export function dailyTextAiLimit(req: Request, res: Response, next: NextFunction) {
  const uid = req.session?.userId;
  if (!uid) return next();
  const day = new Date().toISOString().slice(0, 10);
  const e = textUse.get(uid);
  if (!e || e.day !== day) {
    textUse.set(uid, { day, count: 1 });
    return next();
  }
  if (e.count >= DAILY_TEXT_AI_LIMIT) {
    return res.status(429).json({ error: "You've done a lot today! Please try again tomorrow." });
  }
  e.count++;
  next();
}
