import { db } from "./db";
import { users, type User, stories, illustrations, storyVideos, storytellerProfiles, purchases, storyPerspectives, type Story, type InsertStory, type Illustration, type InsertIllustration, type StoryVideo, type InsertStoryVideo, type StorytellerProfile, type InsertStorytellerProfile, type Purchase, type InsertPurchase, type StoryPerspective, type InsertStoryPerspective } from "@shared/schema";
import { eq, desc, and, sql, isNull } from "drizzle-orm";

export interface IStorage {
  getStories(userId: string): Promise<Story[]>;
  getStory(id: number): Promise<Story | undefined>;
  createStory(story: InsertStory): Promise<Story>;
  updateStory(id: number, story: Partial<InsertStory>): Promise<Story | undefined>;
  deleteStory(id: number): Promise<void>;
  getIllustrations(storyId: number): Promise<Illustration[]>;
  createIllustration(illustration: InsertIllustration): Promise<Illustration>;
  updateIllustration(id: number, data: Partial<InsertIllustration>): Promise<Illustration | undefined>;
  deleteIllustration(id: number): Promise<void>;
  getStoryVideos(storyId: number): Promise<StoryVideo[]>;
  getStoryVideo(id: number): Promise<StoryVideo | undefined>;
  createStoryVideo(video: InsertStoryVideo): Promise<StoryVideo>;
  updateStoryVideo(id: number, data: Partial<InsertStoryVideo>): Promise<StoryVideo | undefined>;
  deleteStoryVideo(id: number): Promise<void>;
  getStorytellerProfiles(userId: string): Promise<StorytellerProfile[]>;
  getStorytellerProfile(id: number): Promise<StorytellerProfile | undefined>;
  createStorytellerProfile(profile: InsertStorytellerProfile): Promise<StorytellerProfile>;
  updateStorytellerProfile(id: number, data: Partial<InsertStorytellerProfile>): Promise<StorytellerProfile | undefined>;
  deleteStorytellerProfile(id: number): Promise<void>;
  getStoryByShareToken(token: string): Promise<Story | undefined>;
  getStoryPerspectives(storyId: number): Promise<StoryPerspective[]>;
  createStoryPerspective(perspective: InsertStoryPerspective): Promise<StoryPerspective>;
  deleteStoryPerspective(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // ---- users ----
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, email.toLowerCase()));
    return user;
  }

  async createUser(data: typeof users.$inferInsert): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }

  async countUsers(): Promise<number> {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    return Number(row.count);
  }

  /** Give stories/profiles created before accounts existed to this user. */
  async claimUnownedData(userId: string): Promise<void> {
    await db.update(stories).set({ userId }).where(isNull(stories.userId));
    await db.update(storytellerProfiles).set({ userId }).where(isNull(storytellerProfiles.userId));
  }

  // ---- stories ----
  async getStories(userId: string): Promise<Story[]> {
    return db.select().from(stories).where(eq(stories.userId, userId)).orderBy(desc(stories.createdAt));
  }

  async getStory(id: number): Promise<Story | undefined> {
    const [story] = await db.select().from(stories).where(eq(stories.id, id));
    return story;
  }

  async createStory(story: InsertStory): Promise<Story> {
    const [created] = await db.insert(stories).values(story).returning();
    return created;
  }

  async updateStory(id: number, story: Partial<InsertStory>): Promise<Story | undefined> {
    const [updated] = await db.update(stories).set(story).where(eq(stories.id, id)).returning();
    return updated;
  }

  async deleteStory(id: number): Promise<void> {
    await db.delete(stories).where(eq(stories.id, id));
  }

  async getIllustrations(storyId: number): Promise<Illustration[]> {
    return db.select().from(illustrations).where(eq(illustrations.storyId, storyId)).orderBy(illustrations.sceneOrder, illustrations.createdAt);
  }

  async getIllustration(id: number): Promise<Illustration | undefined> {
    const [ill] = await db.select().from(illustrations).where(eq(illustrations.id, id));
    return ill;
  }

  async createIllustration(illustration: InsertIllustration): Promise<Illustration> {
    const [created] = await db.insert(illustrations).values(illustration).returning();
    return created;
  }

  async updateIllustration(id: number, data: Partial<InsertIllustration>): Promise<Illustration | undefined> {
    const [updated] = await db.update(illustrations).set(data).where(eq(illustrations.id, id)).returning();
    return updated;
  }

  async deleteIllustration(id: number): Promise<void> {
    await db.delete(illustrations).where(eq(illustrations.id, id));
  }

  async getStoryVideos(storyId: number): Promise<StoryVideo[]> {
    return db.select().from(storyVideos).where(eq(storyVideos.storyId, storyId)).orderBy(desc(storyVideos.createdAt));
  }

  async getStoryVideo(id: number): Promise<StoryVideo | undefined> {
    const [video] = await db.select().from(storyVideos).where(eq(storyVideos.id, id));
    return video;
  }

  async createStoryVideo(video: InsertStoryVideo): Promise<StoryVideo> {
    const [created] = await db.insert(storyVideos).values(video).returning();
    return created;
  }

  async updateStoryVideo(id: number, data: Partial<InsertStoryVideo>): Promise<StoryVideo | undefined> {
    const [updated] = await db.update(storyVideos).set(data).where(eq(storyVideos.id, id)).returning();
    return updated;
  }

  async deleteStoryVideo(id: number): Promise<void> {
    await db.delete(storyVideos).where(eq(storyVideos.id, id));
  }

  async getStorytellerProfiles(userId: string): Promise<StorytellerProfile[]> {
    return db.select().from(storytellerProfiles).where(eq(storytellerProfiles.userId, userId)).orderBy(desc(storytellerProfiles.createdAt));
  }

  async getStorytellerProfile(id: number): Promise<StorytellerProfile | undefined> {
    const [profile] = await db.select().from(storytellerProfiles).where(eq(storytellerProfiles.id, id));
    return profile;
  }

  async createStorytellerProfile(profile: InsertStorytellerProfile): Promise<StorytellerProfile> {
    const [created] = await db.insert(storytellerProfiles).values(profile).returning();
    return created;
  }

  async updateStorytellerProfile(id: number, data: Partial<InsertStorytellerProfile>): Promise<StorytellerProfile | undefined> {
    const [updated] = await db.update(storytellerProfiles).set(data).where(eq(storytellerProfiles.id, id)).returning();
    return updated;
  }

  async deleteStorytellerProfile(id: number): Promise<void> {
    await db.delete(storytellerProfiles).where(eq(storytellerProfiles.id, id));
  }

  async getStoryByShareToken(token: string): Promise<Story | undefined> {
    const [story] = await db.select().from(stories).where(eq(stories.shareToken, token));
    return story;
  }

  async getStoryPerspectives(storyId: number): Promise<StoryPerspective[]> {
    return db.select().from(storyPerspectives).where(eq(storyPerspectives.storyId, storyId)).orderBy(storyPerspectives.createdAt);
  }

  async getStoryPerspective(id: number): Promise<StoryPerspective | undefined> {
    const [p] = await db.select().from(storyPerspectives).where(eq(storyPerspectives.id, id));
    return p;
  }

  async createStoryPerspective(perspective: InsertStoryPerspective): Promise<StoryPerspective> {
    const [created] = await db.insert(storyPerspectives).values(perspective).returning();
    return created;
  }

  async deleteStoryPerspective(id: number): Promise<void> {
    await db.delete(storyPerspectives).where(eq(storyPerspectives.id, id));
  }

  async createPurchase(purchase: InsertPurchase): Promise<Purchase> {
    const [created] = await db.insert(purchases).values(purchase).returning();
    return created;
  }

  async getPurchaseByStripeSession(stripeSessionId: string): Promise<Purchase | undefined> {
    const [purchase] = await db.select().from(purchases).where(eq(purchases.stripeSessionId, stripeSessionId));
    return purchase;
  }

  async updatePurchaseStatus(stripeSessionId: string, status: string, paymentIntentId?: string): Promise<Purchase | undefined> {
    const updates: any = { status };
    if (paymentIntentId) updates.stripePaymentIntentId = paymentIntentId;
    const [updated] = await db.update(purchases).set(updates).where(eq(purchases.stripeSessionId, stripeSessionId)).returning();
    return updated;
  }

  /** sessionId here is the buyer's user id. */
  async getPurchasesForStory(sessionId: string, storyId: number): Promise<Purchase[]> {
    return db.select().from(purchases).where(
      and(
        eq(purchases.sessionId, sessionId),
        eq(purchases.storyId, storyId),
        eq(purchases.status, "paid")
      )
    );
  }

  async getStripeProducts() {
    const result = await db.execute(
      sql`SELECT p.id, p.name, p.description, p.metadata, p.active,
          pr.id as price_id, pr.unit_amount, pr.currency
          FROM stripe.products p
          LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
          WHERE p.active = true
          ORDER BY pr.unit_amount`
    );
    return result.rows;
  }
}

export const storage = new DatabaseStorage();
