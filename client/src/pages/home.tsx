import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Mic, PenLine, BookOpen, Sparkles, ArrowRight, Library } from "lucide-react";
import type { Story } from "@shared/schema";

const heroImg = "/images/hero-storytelling.png";

const ERA_LABELS: Record<string, string> = {
  "1940s": "The 1940s",
  "1950s": "The 1950s",
  "1960s": "The 1960s",
  "1970s": "The 1970s",
  "1980s": "The 1980s",
  "1990s": "The 1990s",
  "2000s": "The 2000s",
  "2010s": "The 2010s",
  "2020s": "The 2020s",
};

export default function Home() {
  const { data: stories, isLoading } = useQuery<Story[]>({
    queryKey: ["/api/stories"],
  });

  const recentStories = stories?.slice(0, 3) || [];
  const totalStories = stories?.length || 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="relative w-full h-80 md:h-96 lg:h-[28rem]">
        <img
          src={heroImg}
          alt="Storytelling"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-black/20" />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pt-8">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-2 tracking-tight" data-testid="text-hero-title">
            Storyteller
          </h1>
          <p className="text-white/90 text-lg md:text-xl lg:text-2xl max-w-xl mb-1 font-medium">
            Every Life Has a Story Worth Keeping
          </p>
          <p className="text-white/80 text-sm md:text-base max-w-lg mb-6">
            Record your memories, and watch them come alive as beautiful illustrated storybooks for your grandchildren.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/record">
              <Button size="lg" data-testid="button-hero-record">
                <Mic className="mr-2 h-4 w-4" />
                Tell Your Story
              </Button>
            </Link>
            <Link href="/new">
              <Button size="lg" variant="outline" className="bg-white/10 backdrop-blur-sm text-white border-white/30" data-testid="button-hero-write">
                <PenLine className="mr-2 h-4 w-4" />
                Write It Down
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-10">
        <section>
          <h2 className="text-xl font-semibold mb-4">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="hover-elevate">
              <CardContent className="p-5 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Mic className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold">1. Share Your Memory</h3>
                <p className="text-sm text-muted-foreground">
                  Talk into your phone, type it out, or sit with someone who can help you record your story.
                </p>
              </CardContent>
            </Card>
            <Card className="hover-elevate">
              <CardContent className="p-5 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold">2. Choose Your Style</h3>
                <p className="text-sm text-muted-foreground">
                  Pick cartoon, realistic, or era-authentic style. AI brings your words to life as beautiful illustrations.
                </p>
              </CardContent>
            </Card>
            <Card className="hover-elevate">
              <CardContent className="p-5 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <BookOpen className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold">3. Share With Family</h3>
                <p className="text-sm text-muted-foreground">
                  Your grandkids can see and experience your memories through illustrated storybooks they'll treasure.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-1 mb-4">
            <h2 className="text-xl font-semibold">Recent Stories</h2>
            {totalStories > 0 && (
              <Link href="/stories">
                <Button variant="ghost" size="sm" data-testid="button-view-all-stories">
                  View all ({totalStories})
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            )}
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardContent className="p-0">
                    <Skeleton className="h-40 rounded-t-md" />
                    <div className="p-4 space-y-2">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : recentStories.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {recentStories.map((story) => (
                <Link key={story.id} href={`/stories/${story.id}`}>
                  <Card className="hover-elevate cursor-pointer h-full" data-testid={`card-story-${story.id}`}>
                    <CardContent className="p-0">
                      {story.coverImageUrl ? (
                        <img
                          src={story.coverImageUrl}
                          alt={story.title}
                          className="h-40 w-full object-cover rounded-t-md"
                        />
                      ) : (
                        <div className="h-40 bg-primary/5 rounded-t-md flex items-center justify-center">
                          <BookOpen className="h-10 w-10 text-primary/30" />
                        </div>
                      )}
                      <div className="p-4 space-y-1">
                        <h3 className="font-semibold truncate" data-testid={`text-story-title-${story.id}`}>{story.title}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {story.content.substring(0, 120)}...
                        </p>
                        <div className="flex flex-wrap gap-1 pt-1">
                          {story.era && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                              {ERA_LABELS[story.era] || story.era}
                            </span>
                          )}
                          {story.category && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {story.category}
                            </span>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Library className="h-8 w-8 text-primary/50" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">No stories yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Start preserving your precious memories today. Every story matters.
                  </p>
                  <div className="flex flex-wrap gap-3 justify-center">
                    <Link href="/record">
                      <Button data-testid="button-empty-record">
                        <Mic className="mr-2 h-4 w-4" />
                        Record a Story
                      </Button>
                    </Link>
                    <Link href="/new">
                      <Button variant="secondary" data-testid="button-empty-write">
                        <PenLine className="mr-2 h-4 w-4" />
                        Write a Story
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
