# Storyteller

A digital legacy app where grandparents and aunties can record their life stories and have AI transform them into beautiful illustrated storybooks for their grandchildren.

## Architecture

- **Frontend**: React + TypeScript + Vite with Tailwind CSS + shadcn/ui components
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI via Replit AI Integrations (image generation, audio transcription, text enhancement, TTS narration)
- **AI Video**: Replicate API with Wan2.1 model (real AI-generated video clips from scene images, requires REPLICATE_API_TOKEN secret)
- **Payments**: Stripe integration for one-time download purchases (PDF $4.99, Video $6.99, Bundle $9.99)

## Key Features

- **Voice Recording**: Record stories by speaking into the microphone, auto-transcribed via AI
- **Written Stories**: Type stories directly with AI-powered title suggestions and story polishing
- **AI Illustrations**: Generate illustrations in 3 styles (cartoon, realistic, era-authentic) with variable page count (2/4/6/8 pages). Character consistency chaining: scene 1 generates first with the profile photo, then all subsequent scenes use scene 1's output as the visual reference so the character looks identical across all pages. Activity-aware clothing (shirtless for surfing/swimming, etc.).
- **Custom Page Text**: Edit AI captions on illustration pages — write your own text or keep the AI caption, with clear labels showing which is which
- **AI Video Stories**: Generate real AI-powered moving video clips per scene (via Replicate API), stitched into a complete mini-movie with transitions and voice narration
- **Voice Narration**: AI TTS narration for video stories using selectable voices (alloy/echo/fable/onyx/nova/shimmer)
- **Storyteller Profile**: Upload multiple reference photos (different angles, lighting, expressions), AI analyzes ALL photos together for a detailed appearance description, and you appear as the character in all generated illustrations and videos
- **Family Sharing & Gifting**: Generate shareable links with optional gift messages — recipients see a beautiful read-only storybook view
- **Collaborative Stories**: Multiple family members can add their own perspective to the same story event
- **Story Prompts**: Library of 30+ thoughtful prompts organized by category to help spark memories
- **Family Timeline**: Visual chronological timeline of all stories grouped by decade
- **Print-Ready PDF**: Beautiful storybook PDF with cover page, illustrated pages, custom text, page numbers, and elegant typography
- **Story Organization**: Filter/search by era (1940s-2020s) and category (Childhood, Family, Love, etc.)
- **Purchases**: Stripe-powered one-time purchases for PDF, video, and bundle downloads

## Project Structure

```
client/src/
  App.tsx                    - Main app with sidebar + routing
  pages/
    home.tsx                 - Landing page with hero + recent stories
    stories.tsx              - Story library with search/filters
    story-detail.tsx         - Individual story view + illustration/video generation + sharing + perspectives
    new-story.tsx            - Write a new story (supports pre-fill from prompts)
    record-story.tsx         - Voice-record a story
    profile.tsx              - Storyteller profile + photo upload + voice selection
    prompts.tsx              - Story prompt library with categories
    timeline.tsx             - Family tree timeline grouped by decade
    shared-story.tsx         - Public read-only shared storybook view
  components/
    app-sidebar.tsx          - Navigation sidebar
    story-player.tsx         - Video player for story movies
    theme-provider.tsx       - Light/dark theme context
    theme-toggle.tsx         - Theme toggle button

server/
  index.ts                   - Express server entry
  routes.ts                  - API routes (stories, illustrations, transcription, AI, sharing, perspectives, PDF)
  storage.ts                 - Database storage layer
  db.ts                      - Database connection
  seed.ts                    - Seed data with sample stories
  luma-client.ts             - Replicate AI client for real AI video generation (image-to-video)
  video-generator.ts         - Video generation (Replicate AI clips + FFmpeg stitching + narration)

shared/
  schema.ts                  - Drizzle schema (stories, illustrations, perspectives, users, purchases, etc.)
```

## Database Schema

- `stories` - Main stories table (title, content, era, category, contentRating [G/PG/M], coverImageUrl, shareToken, giftMessage)
- `illustrations` - AI-generated illustrations linked to stories (imageUrl, style, prompt, customText for user-editable page text)
- `storyVideos` - Animated storybooks with multiple scenes (storyId, style, status, scenes JSON)
- `storytellerProfiles` - Storyteller photo/appearance/voice profiles (name, photoUrl, additionalPhotos[], appearanceDescription, voicePreference, voiceSampleUrl)
- `storyPerspectives` - Multiple family perspectives on the same story (storyId, authorName, content)
- `purchases` - Stripe purchase records (sessionId, storyId, productType, status)
- `users` - User accounts (not yet used, for future auth)

## API Endpoints

- `GET /api/stories` - List all stories
- `GET /api/stories/:id` - Get story with illustrations
- `POST /api/stories` - Create a story
- `PATCH /api/stories/:id` - Update a story
- `DELETE /api/stories/:id` - Delete a story
- `POST /api/stories/:id/illustrations` - Generate AI illustration
- `PATCH /api/illustrations/:id` - Update illustration (custom text)
- `DELETE /api/illustrations/:id` - Delete illustration
- `POST /api/transcribe` - Transcribe audio to text
- `POST /api/enhance-story` - Polish story text with AI
- `POST /api/suggest-title` - AI-suggest a title
- `POST /api/preview-voice` - Preview TTS voice with sample text
- `GET /api/video-config` - Check if AI video (Replicate) is enabled
- `GET /api/stories/:id/videos` - List videos for a story
- `POST /api/stories/:id/videos` - Generate AI video movie (async, returns 202)
- `GET /api/videos/:id` - Get video status/scenes (for polling)
- `DELETE /api/videos/:id` - Delete video
- `GET /api/storyteller-profiles` - List profiles
- `POST /api/storyteller-profiles` - Create profile with photo
- `PATCH /api/storyteller-profiles/:id` - Update profile/photo
- `POST /api/storyteller-profiles/:id/photos` - Add additional reference photo (re-analyzes all photos)
- `DELETE /api/storyteller-profiles/:id/photos` - Remove additional reference photo (re-analyzes remaining)
- `DELETE /api/storyteller-profiles/:id` - Delete profile
- `POST /api/stories/:id/share` - Generate share link with optional gift message
- `GET /api/shared/:token` - Public shared story view (read-only)
- `GET /api/stories/:id/perspectives` - List perspectives for a story
- `POST /api/stories/:id/perspectives` - Add a perspective
- `DELETE /api/perspectives/:id` - Delete a perspective
- `GET /api/stories/:id/download/pdf` - Download print-ready PDF storybook
- `GET /api/stripe/publishable-key` - Stripe public key
- `GET /api/stripe/products` - List Stripe products/prices
- `POST /api/stripe/checkout` - Create checkout session
- `POST /api/stripe/verify-payment` - Verify payment after redirect
- `GET /api/stories/:id/purchases` - Get purchases for a story

## Design

- Warm amber/golden color scheme (hue 25) for nostalgic feel
- Lora serif font for storybook character
- Dark/light theme support
- Responsive sidebar layout

## Future Roadmap

- **User Authentication**: Proper login/signup to replace browser session tracking
- **Audio Stories**: Let users record audio narration that gets attached to illustrations
- **Multi-language Support**: Translate stories for bilingual families
- **Family Groups**: Create family groups so multiple users can contribute to a shared story collection
- **Story Templates**: Pre-designed storybook templates with different visual themes
- **Export to Physical Book**: Partnership with print-on-demand services for hardcover books
- **AI Story Enhancement**: AI suggestions to expand short stories with vivid details while keeping the storyteller's voice
