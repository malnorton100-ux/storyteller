import { db } from "./db";
import { stories } from "@shared/schema";
import { sql } from "drizzle-orm";

export async function seedDatabase() {
  const existing = await db.select({ count: sql<number>`count(*)` }).from(stories);
  if (existing[0].count > 0) return;

  console.log("Seeding database with sample stories...");

  await db.insert(stories).values([
    {
      title: "The Summer Picnics at Grandpa's Farm",
      content: `Every summer, we'd pile into Dad's old Chevy and drive two hours to Grandpa's farm. The car would be packed with blankets, a wicker basket full of Mama's fried chicken, and us three kids squished together in the back seat.\n\nGrandpa would be standing at the gate, waving his straw hat. The farm smelled like fresh hay and honeysuckle. We'd run straight to the big oak tree where Grandpa had hung a tire swing.\n\nAfter lunch, Grandpa would tell us about the time he found a baby fox in the barn, or how Grandma once chased a rooster clear across the county road. We'd laugh until our bellies hurt.\n\nThose were the days when time moved slow and everything tasted better. I can still hear the crickets singing as the sun went down, and feel the cool grass under my bare feet. Those summer picnics were the best days of my life.`,
      era: "1950s",
      category: "Childhood",
      coverImageUrl: "/images/seed-story-1.png",
      audioTranscript: null,
    },
    {
      title: "Baking with Nana Rose",
      content: `Nana Rose had magic hands. At least that's what I believed as a little girl standing on a step stool in her kitchen, watching her knead bread dough like it was the most natural thing in the world.\n\n"The secret," she'd say, tapping my nose with a floury finger, "is patience and love. You can't rush good bread."\n\nHer kitchen was always warm. The yellow wallpaper had little teapots on it, and there was always something simmering on the stove. She taught me to make her famous cinnamon rolls - the ones the whole neighborhood would line up for at the church bake sale.\n\nShe never used a recipe book. Everything was "a pinch of this" and "a handful of that." I tried to write it all down in a little notebook, but she'd just laugh and say, "Your hands will remember, dear."\n\nShe was right. Forty years later, my hands still remember.`,
      era: "1960s",
      category: "Cooking",
      coverImageUrl: "/images/seed-story-2.png",
      audioTranscript: null,
    },
    {
      title: "The Night We Danced in the Rain",
      content: `It was our wedding day, June 14th, 1975. Everything was supposed to be perfect - the garden ceremony, the flowers, the band playing our song. And then the sky opened up.\n\nEveryone ran for cover under the tent, but your grandfather just grabbed my hand and pulled me onto the dance floor. "We're not letting a little rain ruin our first dance," he said with that grin of his.\n\nSo there we were, dancing in the pouring rain, my white dress getting soaked, his suit dripping, and the band playing "Unforgettable" under the safety of the tent while we twirled in the downpour.\n\nOur guests started clapping, and then one by one, other couples joined us. Pretty soon, half the wedding party was dancing in the rain.\n\nYour grandfather always said it was the best decision he ever made. Well, the second best - the first was asking me to marry him.`,
      era: "1970s",
      category: "Love",
      coverImageUrl: "/images/seed-story-3.png",
      audioTranscript: null,
    },
    {
      title: "Building the Treehouse Together",
      content: `The summer of 1985, I decided my kids needed a treehouse. Not just any treehouse - I wanted to build them a proper one, like the one my father built for me.\n\nI spent weeks drawing plans on graph paper at the kitchen table. Your mother, she was twelve then, kept adding rooms. "It needs a lookout tower, Dad!" And your uncle wanted a trapdoor.\n\nWe started on a Saturday morning in July. The big maple in the backyard was perfect - strong branches, good shade. I taught them how to measure twice and cut once, how to hold a hammer properly, how to level a board.\n\nIt took us the whole summer. There were smashed thumbs, crooked boards we had to redo, and one memorable moment when I stepped on a board that wasn't nailed down yet.\n\nBut when it was done, it was beautiful. Two rooms, a rope ladder, and yes - a lookout tower. Those kids spent every weekend up in that tree until they went off to college. The treehouse is still standing, waiting for the next generation.`,
      era: "1980s",
      category: "Family",
      coverImageUrl: "/images/seed-story-4.png",
      audioTranscript: null,
    },
  ]);

  console.log("Seed data inserted successfully.");
}
