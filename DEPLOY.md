# Deploying to Railway

The app builds from the `Dockerfile` (includes ffmpeg) and is configured by `railway.json`.
Every push to `main` on GitHub redeploys automatically. All steps below can be done on a phone in Safari.

## 1. Create the project
1. Go to **railway.com** → **Login** → **Login with GitHub** (malnorton100-ux).
2. **New Project** → **Deploy from GitHub repo** → pick **storyteller**.
   (If it's not listed, tap *Configure GitHub App* and allow the repo.)
3. In the project, tap **+ Create** → **Database** → **PostgreSQL**.

## 2. Add a volume (keeps photos, illustrations and videos between deploys)
Open the **storyteller** service → **Settings** (or long-press the service) → **Volume** → **Add volume**, mount path: `/data`

## 3. Variables
Open the **storyteller** service → **Variables** → add:

| Name | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `DATA_DIR` | `/data` |
| `SESSION_SECRET` | any long random string (40+ letters/numbers) |
| `ADMIN_EMAIL` | the owner's email |
| `OPENAI_API_KEY` | from platform.openai.com → API keys (needs billing set up) |
| `REPLICATE_API_TOKEN` | from replicate.com → Account → API tokens (for AI video) |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys (start with test keys `sk_test_…`) |
| `STRIPE_PUBLISHABLE_KEY` | same page (`pk_test_…`) |

Optional: `PUBLIC_URL` if you add your own domain (e.g. `https://legacyweaver.com.au`). Otherwise the Railway address is used automatically.

## 4. Give it a web address
**Settings** → **Networking** → **Generate Domain**. Open it once the deploy shows **Active**.

## 5. First login
Sign up with the owner's email first.

## What happens on each deploy
- Database tables are created/updated automatically (`drizzle-kit push --force` in the Dockerfile).
  Because it runs with `--force`, avoid renaming or removing database columns without a plan.
- The Stripe webhook is registered automatically at `<your address>/api/stripe/webhook`.
- Files saved by the app go to `/data/public` (served to browsers) and `/data/private` (not served).
