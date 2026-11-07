# Legacy Weaver / Storyteller - production image (used by Railway)
FROM node:22-bookworm-slim

# ffmpeg builds the story videos and converts voice recordings
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
# Create/update database tables, then start the app
CMD ["sh", "-c", "npx drizzle-kit push --force || echo 'WARNING: database update failed'; node dist/index.cjs"]
