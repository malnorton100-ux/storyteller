import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const stories = pgTable("stories", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  era: text("era"),
  category: text("category"),
  contentRating: text("content_rating").default("G"),
  coverImageUrl: text("cover_image_url"),
  audioTranscript: text("audio_transcript"),
  shareToken: text("share_token").unique(),
  giftMessage: text("gift_message"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const illustrations = pgTable("illustrations", {
  id: serial("id").primaryKey(),
  storyId: integer("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(),
  style: text("style").notNull(),
  prompt: text("prompt").notNull(),
  sceneCaption: text("scene_caption"),
  customText: text("custom_text"),
  sceneOrder: integer("scene_order").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const storyVideos = pgTable("story_videos", {
  id: serial("id").primaryKey(),
  storyId: integer("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
  style: text("style").notNull(),
  status: text("status").notNull().default("pending"),
  videoUrl: text("video_url"),
  scenes: json("scenes").$type<{ imageUrl: string; caption: string }[]>().default([]),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const storytellerProfiles = pgTable("storyteller_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  photoUrl: text("photo_url"),
  additionalPhotos: text("additional_photos").array(),
  appearanceDescription: text("appearance_description"),
  voicePreference: text("voice_preference"),
  voiceSampleUrl: text("voice_sample_url"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const purchases = pgTable("purchases", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  storyId: integer("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
  productType: text("product_type").notNull(),
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const storyPerspectives = pgTable("story_perspectives", {
  id: serial("id").primaryKey(),
  storyId: integer("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
  authorName: text("author_name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});
export const insertStorySchema = createInsertSchema(stories).omit({
  id: true,
  createdAt: true,
});
export const insertIllustrationSchema = createInsertSchema(illustrations).omit({
  id: true,
  createdAt: true,
});
export const insertStoryVideoSchema = createInsertSchema(storyVideos).omit({
  id: true,
  createdAt: true,
});
export const insertStorytellerProfileSchema = createInsertSchema(storytellerProfiles).omit({
  id: true,
  createdAt: true,
});
export const insertPurchaseSchema = createInsertSchema(purchases).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Story = typeof stories.$inferSelect;
export type InsertStory = z.infer<typeof insertStorySchema>;
export type Illustration = typeof illustrations.$inferSelect;
export type InsertIllustration = z.infer<typeof insertIllustrationSchema>;
export type StoryVideo = typeof storyVideos.$inferSelect;
export type InsertStoryVideo = z.infer<typeof insertStoryVideoSchema>;
export type StorytellerProfile = typeof storytellerProfiles.$inferSelect;
export type InsertStorytellerProfile = z.infer<typeof insertStorytellerProfileSchema>;
export type Purchase = typeof purchases.$inferSelect;
export const insertStoryPerspectiveSchema = createInsertSchema(storyPerspectives).omit({
  id: true,
  createdAt: true,
});
export type InsertPurchase = z.infer<typeof insertPurchaseSchema>;
export type StoryPerspective = typeof storyPerspectives.$inferSelect;
export type InsertStoryPerspective = z.infer<typeof insertStoryPerspectiveSchema>;
