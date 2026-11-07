import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import crypto from "crypto";
import { promisify } from "util";
import { z } from "zod";
import { pool } from "./db";
import { storage } from "./storage";
import type { Story } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** The logged-in user's id. Only call after requireAuth has run. */
export function userId(req: Request): string {
  return req.session.userId as string;
}

/**
 * Makes sure the tables/columns that accounts need exist, so the app works
 * even if `npm run db:push` hasn't been run yet. Safe to run on every start.
 */
async function ensureAuthSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL PRIMARY KEY, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS name text`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE stories ADD COLUMN IF NOT EXISTS user_id varchar REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE storyteller_profiles ADD COLUMN IF NOT EXISTS user_id varchar REFERENCES users(id) ON DELETE CASCADE`,
  ];
  for (const sql of statements) {
    try {
      await pool.query(sql);
    } catch (err: any) {
      console.warn(`[auth] Schema step skipped (run "npm run db:push" to create tables): ${err.message}`);
    }
  }
}

// Simple in-memory brake on password guessing: 10 failed tries per email+IP per 15 min.
const failedLogins = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
function tooManyAttempts(key: string) {
  const e = failedLogins.get(key);
  if (!e) return false;
  if (Date.now() - e.first > WINDOW_MS) { failedLogins.delete(key); return false; }
  return e.count >= 10;
}
function recordFailure(key: string) {
  const e = failedLogins.get(key);
  if (!e || Date.now() - e.first > WINDOW_MS) failedLogins.set(key, { count: 1, first: Date.now() });
  else e.count++;
}

const registerSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Please enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

const publicUser = (u: { id: string; username: string; name: string | null }) => ({
  id: u.id,
  email: u.username,
  name: u.name,
});

/** Paths under /api that work without logging in. */
const PUBLIC_API = [
  /^\/api\/health$/,
  /^\/api\/auth\//,
  /^\/api\/shared\/[^/]+$/,
  /^\/api\/stripe\/webhook$/,
  /^\/api\/stripe\/publishable-key$/,
  /^\/api\/stripe\/products$/,
];

export async function setupAuth(app: Express) {
  await ensureAuthSchema();

  const isProd = process.env.NODE_ENV === "production";
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (isProd) {
      console.error("FATAL: SESSION_SECRET is not set. Add a long random value to your secrets.");
      process.exit(1);
    }
    secret = crypto.randomBytes(32).toString("hex");
    console.warn("[auth] SESSION_SECRET not set - using a temporary one (logins reset on restart)");
  }

  app.set("trust proxy", 1);
  const PgStore = connectPgSimple(session);
  app.use(
    session({
      store: new PgStore({ pool, tableName: "session", createTableIfMissing: false }),
      secret,
      resave: false,
      saveUninitialized: false,
      name: "lw.sid",
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  const startSession = (req: Request, id: string) =>
    new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => {
        if (err) return reject(err);
        req.session.userId = id;
        req.session.save((e) => (e ? reject(e) : resolve()));
      }),
    );

  app.post("/api/auth/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { name, email, password } = parsed.data;
    try {
      if (await storage.getUserByEmail(email)) {
        return res.status(409).json({ error: "An account with that email already exists. Try logging in." });
      }
      const isFirstUser = (await storage.countUsers()) === 0;
      const user = await storage.createUser({ username: email, password: await hashPassword(password), name });
      // The very first account (the app owner) inherits any stories/profiles made before accounts existed.
      if (isFirstUser) await storage.claimUnownedData(user.id);
      await startSession(req, user.id);
      res.status(201).json(publicUser(user));
    } catch (err) {
      console.error("Register error:", err);
      res.status(500).json({ error: "Could not create your account. Please try again." });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Please enter your email and password" });
    const { email, password } = parsed.data;
    const key = `${email}|${req.ip}`;
    if (tooManyAttempts(key)) {
      return res.status(429).json({ error: "Too many attempts. Please wait 15 minutes and try again." });
    }
    try {
      const user = await storage.getUserByEmail(email);
      if (!user || !(await verifyPassword(password, user.password))) {
        recordFailure(key);
        return res.status(401).json({ error: "Email or password is incorrect" });
      }
      failedLogins.delete(key);
      await startSession(req, user.id);
      res.json(publicUser(user));
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: "Could not log you in. Please try again." });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("lw.sid");
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).json({ error: "Not logged in" });
    res.json(publicUser(user));
  });

  // Everything else under /api needs a logged-in user.
  app.use("/api", (req, res, next) => {
    const full = req.baseUrl + req.path;
    if (PUBLIC_API.some((r) => r.test(full))) return next();
    if (!req.session.userId) return res.status(401).json({ error: "Please log in" });
    next();
  });

  registerOwnershipChecks(app);
}

/**
 * Stops one user reaching another user's data. Each check runs before the
 * matching route and answers 404 (not 403) so ids can't be probed.
 */
function registerOwnershipChecks(app: Express) {
  const notFound = (res: Response) => res.status(404).json({ error: "Not found" });

  const ownsStory = async (req: Request, storyId: number): Promise<Story | null> => {
    const story = await storage.getStory(storyId);
    return story && story.userId === req.session.userId ? story : null;
  };

  const guard =
    (check: (req: Request, id: string) => Promise<boolean>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id ?? req.params.jobId;
        if (await check(req, id)) return next();
        return notFound(res);
      } catch (err) {
        next(err);
      }
    };

  // /api/stories/:id and everything below it
  app.use(
    "/api/stories/:id",
    guard(async (req, id) => {
      if (!/^\d+$/.test(id)) return true; // e.g. /api/stories/generate-covers - not a story id
      return !!(await ownsStory(req, parseInt(id)));
    }),
  );

  app.use(
    "/api/illustrations/:id",
    guard(async (req, id) => {
      const ill = await storage.getIllustration(parseInt(id));
      return !!ill && !!(await ownsStory(req, ill.storyId));
    }),
  );

  app.use(
    "/api/videos/:id",
    guard(async (req, id) => {
      const vid = await storage.getStoryVideo(parseInt(id));
      return !!vid && !!(await ownsStory(req, vid.storyId));
    }),
  );

  app.use(
    "/api/perspectives/:id",
    guard(async (req, id) => {
      const p = await storage.getStoryPerspective(parseInt(id));
      return !!p && !!(await ownsStory(req, p.storyId));
    }),
  );

  app.use(
    "/api/storyteller-profiles/:id",
    guard(async (req, id) => {
      const p = await storage.getStorytellerProfile(parseInt(id));
      return !!p && p.userId === req.session.userId;
    }),
  );
}

/** For illustration jobs, which live in memory and only know their story id. */
export async function userOwnsStory(req: Request, storyId: number): Promise<boolean> {
  const story = await storage.getStory(storyId);
  return !!story && story.userId === req.session.userId;
}
