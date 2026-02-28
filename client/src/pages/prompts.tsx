import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Lightbulb, Search, PenLine } from "lucide-react";

interface Prompt {
  question: string;
  era?: string;
  category: string;
}

const PROMPTS: Prompt[] = [
  { question: "What is your earliest childhood memory? Where were you, and who was with you?", era: "1960s", category: "Childhood" },
  { question: "What games did you play as a child? Did you have a favorite toy?", era: "1970s", category: "Childhood" },
  { question: "What was your neighborhood like growing up? Who were your neighbors?", era: "1960s", category: "Childhood" },
  { question: "Did you have a pet growing up? Tell the story of how you got it.", era: "1970s", category: "Childhood" },

  { question: "What is a family tradition that has been passed down through generations?", category: "Family" },
  { question: "Tell the story of how your parents or grandparents met.", category: "Family" },
  { question: "What was a typical Sunday like in your family when you were growing up?", era: "1970s", category: "Family" },
  { question: "Who was the funniest person in your family? What did they do that made everyone laugh?", category: "Family" },

  { question: "Tell the story of how you met the love of your life.", category: "Love" },
  { question: "What was your first date like? Where did you go?", category: "Love" },
  { question: "Describe the moment you knew you were in love.", category: "Love" },

  { question: "What was your very first job? How did you get it?", era: "1980s", category: "Work" },
  { question: "Who was the most influential mentor or boss you ever had?", category: "Work" },
  { question: "Tell a story about a time you overcame a big challenge at work.", category: "Work" },
  { question: "If you could go back and give your younger self career advice, what would it be?", category: "Work" },

  { question: "What is your favorite holiday memory? What made it so special?", category: "Holidays" },
  { question: "Describe the most memorable Christmas, Hanukkah, or holiday celebration you remember.", category: "Holidays" },
  { question: "What holiday traditions did your family create that you still cherish?", category: "Holidays" },

  { question: "What was the proudest moment of your life?", category: "Milestones" },
  { question: "Tell the story of your wedding day. What do you remember most?", category: "Milestones" },
  { question: "Describe the day your first child (or grandchild) was born.", category: "Milestones" },
  { question: "What was a turning point in your life that changed everything?", category: "Milestones" },

  { question: "What is a recipe that has been in your family for generations? Tell its story.", category: "Food & Cooking" },
  { question: "What was your favorite meal as a child? Who cooked it?", era: "1970s", category: "Food & Cooking" },
  { question: "Tell the story of a memorable dinner party or family gathering around food.", category: "Food & Cooking" },

  { question: "Who was your best friend growing up? How did you meet?", category: "Friendships" },
  { question: "Tell a story about a time a friend was there for you when you needed it most.", category: "Friendships" },
  { question: "What is the funniest thing that ever happened with your friends?", category: "Friendships" },
  { question: "Have you ever reconnected with an old friend after many years? What was that like?", category: "Friendships" },

  { question: "What sport did you love playing growing up? Tell us about your best game.", era: "1970s", category: "Sports & Play" },
  { question: "Did you ride bikes as a kid? Where did you go and who did you ride with?", era: "1960s", category: "Sports & Play" },
  { question: "What did you and your friends do after school for fun?", era: "1970s", category: "Sports & Play" },
  { question: "Tell about a time you won (or lost) a big game or competition. How did it feel?", category: "Sports & Play" },
  { question: "Did you swim at the local pool, river, or beach growing up? What are your best memories of it?", era: "1970s", category: "Sports & Play" },
  { question: "What outdoor adventures did you have as a kid? Did you climb trees, build forts, or explore the bush?", era: "1960s", category: "Sports & Play" },
  { question: "Was there a coach, PE teacher, or older kid who taught you a sport? What did they teach you?", category: "Sports & Play" },
  { question: "What backyard games did your family play at gatherings? Cricket, footy, tag, hide and seek?", category: "Sports & Play" },

  { question: "What is the most important life lesson you have learned?", category: "Life Lessons" },
  { question: "If you could write a letter to your younger self, what would you say?", category: "Life Lessons" },
  { question: "What advice would you give to the next generation about living a good life?", category: "Life Lessons" },
  { question: "Tell about a mistake you made that taught you something valuable.", category: "Life Lessons" },
  { question: "What does 'home' mean to you, and how has that changed over the years?", category: "Life Lessons" },
];

const CATEGORIES = [
  "All",
  "Childhood",
  "Family",
  "Love",
  "Work",
  "Holidays",
  "Milestones",
  "Food & Cooking",
  "Friendships",
  "Sports & Play",
  "Life Lessons",
];

export default function Prompts() {
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = PROMPTS.filter((p) => {
    const matchesCategory = selectedCategory === "All" || p.category === selectedCategory;
    const matchesSearch = searchQuery === "" || p.question.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2.5 shrink-0 mt-0.5">
            <Lightbulb className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-prompts-title">Story Prompts</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Not sure where to start? Pick a prompt below and let the memories flow.
            </p>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search prompts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-prompts"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <Badge
              key={cat}
              variant={selectedCategory === cat ? "default" : "secondary"}
              className={`cursor-pointer toggle-elevate ${selectedCategory === cat ? "toggle-elevated" : ""}`}
              onClick={() => setSelectedCategory(cat)}
              data-testid={`badge-category-${cat.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {cat}
            </Badge>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((prompt, index) => (
            <Card key={index} className="hover-elevate">
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate">{prompt.category}</Badge>
                  {prompt.era && (
                    <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate">{prompt.era}</Badge>
                  )}
                </div>
                <p className="text-sm leading-relaxed" data-testid={`text-prompt-${index}`}>{prompt.question}</p>
                <Link href={`/new?prompt=${encodeURIComponent(prompt.question)}${prompt.era ? `&era=${encodeURIComponent(prompt.era)}` : ""}${prompt.category ? `&category=${encodeURIComponent(prompt.category)}` : ""}`}>
                  <Button variant="outline" size="sm" className="w-full" data-testid={`button-start-prompt-${index}`}>
                    <PenLine className="mr-1.5 h-3.5 w-3.5" />
                    Start This Story
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground" data-testid="text-no-prompts">No prompts found. Try a different category or search term.</p>
          </div>
        )}
      </div>
    </div>
  );
}
