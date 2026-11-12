import { pool } from "./db";

/**
 * Free testers (friends trying the app before launch).
 *
 * Set these in Railway:
 * - TESTER_CODE     the invite code friends type when they sign up, e.g. YARDFRIENDS.
 *                   Leave it empty (or delete it) to switch testing off.
 * - TESTER_SPOTS    how many people can use the code (default 15).
 * - TESTER_STORIES  how many stories each tester gets fully unlocked (default 5).
 *
 * A tester story is unlocked like an "Everything" purchase (pictures + movie +
 * downloads), with the same number of remakes a paying customer gets.
 * A story only counts against the tester's allowance once they start making
 * pictures or a movie for it.
 */
export const TESTER_SPOTS = Number(process.env.TESTER_SPOTS || 15);
export const TESTER_STORIES = Number(process.env.TESTER_STORIES || 5);

function testerCode(): string {
  return (process.env.TESTER_CODE || "").trim().toUpperCase();
}

export async function ensureTesterSchema() {
  const statements = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS tester boolean NOT NULL DEFAULT false`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS tester_stories_used integer NOT NULL DEFAULT 0`,
    `ALTER TABLE stories ADD COLUMN IF NOT EXISTS tester_unlocked boolean NOT NULL DEFAULT false`,
  ];
  for (const sql of statements) {
    try {
      await pool.query(sql);
    } catch (err: any) {
      console.warn(`[testers] Schema step skipped: ${err.message}`);
    }
  }
}

/** Is this invite code right, and are there spots left? */
export async function checkTesterCode(code: string): Promise<"ok" | "wrong" | "full"> {
  const expected = testerCode();
  if (!expected || code.trim().toUpperCase() !== expected) return "wrong";
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE tester = true`);
  return r.rows[0].n < TESTER_SPOTS ? "ok" : "full";
}

/** Make this account a tester (if there's still a spot). */
export async function makeTester(uid: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE users SET tester = true
       WHERE id = $1 AND tester = false
         AND (SELECT COUNT(*) FROM users WHERE tester = true) < $2
       RETURNING id`,
    [uid, TESTER_SPOTS]
  );
  return !!r.rowCount;
}

export async function testerInfo(uid: string): Promise<{ tester: boolean; storiesLeft: number }> {
  const r = await pool.query(`SELECT tester, tester_stories_used FROM users WHERE id = $1`, [uid]);
  const row = r.rows[0];
  if (!row || !row.tester) return { tester: false, storiesLeft: 0 };
  return { tester: true, storiesLeft: Math.max(0, TESTER_STORIES - row.tester_stories_used) };
}

/** True if this story was unlocked with a tester allowance. */
export async function isTesterStory(storyId: number): Promise<boolean> {
  const r = await pool.query(`SELECT tester_unlocked FROM stories WHERE id = $1`, [storyId]);
  return !!r.rows[0]?.tester_unlocked;
}

/**
 * Use one of the tester's free stories to unlock this story.
 * Returns a refund that gives the story back if the AI fails.
 */
export async function claimTesterStory(
  uid: string,
  storyId: number
): Promise<{ ok: true; refund: () => Promise<void> } | { ok: false }> {
  const used = await pool.query(
    `UPDATE users SET tester_stories_used = tester_stories_used + 1
       WHERE id = $1 AND tester = true AND tester_stories_used < $2
       RETURNING id`,
    [uid, TESTER_STORIES]
  );
  if (!used.rowCount) return { ok: false };

  const giveBackSlot = async () => {
    await pool.query(`UPDATE users SET tester_stories_used = GREATEST(tester_stories_used - 1, 0) WHERE id = $1`, [uid]);
  };

  const unlocked = await pool.query(
    `UPDATE stories SET tester_unlocked = true WHERE id = $1 AND tester_unlocked = false RETURNING id`,
    [storyId]
  );
  if (!unlocked.rowCount) {
    // Someone else unlocked it at the same moment - don't charge twice.
    await giveBackSlot();
    return { ok: true, refund: async () => {} };
  }
  return {
    ok: true,
    refund: async () => {
      await pool.query(`UPDATE stories SET tester_unlocked = false WHERE id = $1`, [storyId]);
      await giveBackSlot();
    },
  };
}
