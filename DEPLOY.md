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

## AI model settings (optional)
Defaults are in `server/config.ts`. Override in Railway → Variables when OpenAI retires a model:

| Variable | Default | Note |
|---|---|---|
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.5-flare` | gpt-image-1 was shut down 23 Oct 2026. Alternative: `gpt-image-2.5-sunburst` |
| `OPENAI_TEXT_MODEL` | `gpt-5.2` | |
| `OPENAI_AUDIO_MODEL` | `gpt-audio` | retires 20 Jan 2027 → `gpt-audio-1.5` |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-4o-mini-transcribe` | retires 26 Feb 2027 → `gpt-transcribe` |
| `REPLICATE_VIDEO_MODEL` | `wavespeedai/wan-2.1-i2v-480p` | the model that animates each scene (older, 480p) |
| `REPLICATE_VIDEO_INPUT` | *(preset)* | JSON of the model's inputs with `{{image}}`, `{{prompt}}`, `{{aspect_ratio}}` placeholders - copy input names from the model's API tab on replicate.com |

## Email notifications (optional)
"Your movie is ready" / "couldn't finish" emails are sent through Resend when these are set:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | from resend.com → API Keys |
| `EMAIL_FROM` | e.g. `Storyteller <hello@yourdomain.com>` (needs the domain verified in Resend; without it Resend's test sender only delivers to your own Resend sign-up email) |

Other movie settings: `VIDEO_CLIP_SECONDS` (5 or 10, default 10), `VIDEO_PARALLEL_SCENES` (default 4), `VIDEO_MAX_SIDE` (default 960).

## Own-voice narration
If a storyteller has recorded a voice sample in their profile, movie narration is spoken in **their own voice** using Replicate (same `REPLICATE_API_TOKEN` as the video clips). If it fails, it falls back to the AI voice they picked (or "fable").

| Variable | Default | Note |
|---|---|---|
| `VOICE_CLONE_MODEL` | `resemble-ai/chatterbox-multilingual` | any Replicate voice-cloning model |
| `VOICE_CLONE_LANGUAGE` | `en` | language code for narration |
| `VOICE_CLONE_INPUT` | *(preset)* | JSON of the model's inputs with `{{text}}`, `{{audio}}`, `{{language}}` placeholders, if you switch model |
## Who pays for the AI (paywall)
- Every new account gets **one free 2-page storybook**.
- More pictures need any purchase on that story; the **movie needs the Movie or Bundle** purchase first.
- Each purchase gives a few goes; failed attempts don't count. The owner (`ADMIN_EMAIL`) is never limited.
- New stories no longer get an AI-painted cover; the first storybook picture becomes the cover.

| Variable | Default | Note |
|---|---|---|
| `PICTURE_RUNS_PER_PURCHASE` | `3` | picture goes per purchase |
| `MOVIE_RUNS_PER_PURCHASE` | `2` | movie goes per Movie/Bundle purchase |
| `DAILY_TEXT_AI_LIMIT` | `150` | cheap AI calls (transcribe, story helper, titles) per account per day |

## Password reset emails
"Forgot your password?" emails a 1-hour link through Resend. Needs `RESEND_API_KEY`, and `EMAIL_FROM` on a domain you've verified in Resend (e.g. `Storyteller <hello@yourdomain.com.au>`). Until a domain is verified, Resend only delivers to your own address.

## Voice recordings are private
Voice samples are stored in `/data/private/voice-samples` and only play for their owner. Old public recordings are moved there automatically on start-up.

## Prices (set automatically in Stripe on start-up)
Storybook A$9.99, Movie A$14.99, Everything A$19.99. To change them, set `PRICE_STORYBOOK_CENTS`, `PRICE_MOVIE_CENTS`, `PRICE_EVERYTHING_CENTS` (e.g. `1499` = $14.99) in Railway and redeploy. Old prices are archived automatically.
