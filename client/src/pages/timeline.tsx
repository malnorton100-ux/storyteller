import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, Clock, Filter } from "lucide-react";
import type { Story } from "@shared/schema";

const CATEGORIES = ["All Categories", "Childhood", "Family", "Love", "Work", "Travel", "Holidays", "Friendship", "Life Lessons", "Cooking", "Other"];

const DECADES = ["1940s", "1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];

function getDecade(era: string | null): string | null {
  if (!era) return null;
  const match = era.match(/(\d{4})s/);
  if (match) return match[0];
  return null;
}

function TimelineCard({ story, side }: { story: Story; side: "left" | "right" }) {
  return (
    <div
      className={`flex items-start gap-4 w-full ${
        side === "left" ? "flex-row-reverse md:flex-row-reverse" : "flex-row md:flex-row"
      }`}
      data-testid={`timeline-card-${story.id}`}
    >
      {side === "left" ? (
        <>
          <div className="hidden md:block flex-1" />
          <div className="hidden md:flex flex-col items-center">
            <div className="w-3 h-3 rounded-full bg-primary border-2 border-background ring-2 ring-primary/30" />
          </div>
          <div className="flex-1 min-w-0">
            <Link href={`/stories/${story.id}`}>
              <Card className="hover-elevate cursor-pointer" data-testid={`card-timeline-story-${story.id}`}>
                <CardContent className="p-0">
                  <div className="flex flex-col sm:flex-row">
                    {story.coverImageUrl ? (
                      <img
                        src={story.coverImageUrl}
                        alt={story.title}
                        className="w-full sm:w-24 h-24 object-cover rounded-t-md sm:rounded-t-none sm:rounded-l-md flex-shrink-0"
                      />
                    ) : (
                      <div className="w-full sm:w-24 h-24 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 rounded-t-md sm:rounded-t-none sm:rounded-l-md flex items-center justify-center flex-shrink-0">
                        <BookOpen className="h-6 w-6 text-primary/30" />
                      </div>
                    )}
                    <div className="p-3 min-w-0 flex-1">
                      <h3 className="font-semibold text-sm truncate" data-testid={`text-timeline-title-${story.id}`}>{story.title}</h3>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                        {story.content.substring(0, 100)}...
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {story.era && (
                          <Badge variant="secondary" className="text-xs no-default-active-elevate">
                            {story.era}
                          </Badge>
                        )}
                        {story.category && (
                          <Badge variant="outline" className="text-xs no-default-active-elevate">
                            {story.category}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <Link href={`/stories/${story.id}`}>
              <Card className="hover-elevate cursor-pointer" data-testid={`card-timeline-story-${story.id}`}>
                <CardContent className="p-0">
                  <div className="flex flex-col sm:flex-row">
                    {story.coverImageUrl ? (
                      <img
                        src={story.coverImageUrl}
                        alt={story.title}
                        className="w-full sm:w-24 h-24 object-cover rounded-t-md sm:rounded-t-none sm:rounded-l-md flex-shrink-0"
                      />
                    ) : (
                      <div className="w-full sm:w-24 h-24 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 rounded-t-md sm:rounded-t-none sm:rounded-l-md flex items-center justify-center flex-shrink-0">
                        <BookOpen className="h-6 w-6 text-primary/30" />
                      </div>
                    )}
                    <div className="p-3 min-w-0 flex-1">
                      <h3 className="font-semibold text-sm truncate" data-testid={`text-timeline-title-${story.id}`}>{story.title}</h3>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                        {story.content.substring(0, 100)}...
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {story.era && (
                          <Badge variant="secondary" className="text-xs no-default-active-elevate">
                            {story.era}
                          </Badge>
                        )}
                        {story.category && (
                          <Badge variant="outline" className="text-xs no-default-active-elevate">
                            {story.category}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
          <div className="hidden md:flex flex-col items-center">
            <div className="w-3 h-3 rounded-full bg-primary border-2 border-background ring-2 ring-primary/30" />
          </div>
          <div className="hidden md:block flex-1" />
        </>
      )}
    </div>
  );
}

export default function Timeline() {
  const [categoryFilter, setCategoryFilter] = useState("All Categories");

  const { data: stories, isLoading } = useQuery<Story[]>({
    queryKey: ["/api/stories"],
  });

  const filtered = useMemo(() => {
    if (!stories) return [];
    if (categoryFilter === "All Categories") return stories;
    return stories.filter((s) => s.category === categoryFilter);
  }, [stories, categoryFilter]);

  const grouped = useMemo(() => {
    const decadeMap: Record<string, Story[]> = {};
    const undated: Story[] = [];

    for (const story of filtered) {
      const decade = getDecade(story.era);
      if (decade) {
        if (!decadeMap[decade]) decadeMap[decade] = [];
        decadeMap[decade].push(story);
      } else {
        undated.push(story);
      }
    }

    const sortedDecades = DECADES.filter((d) => decadeMap[d]?.length > 0);
    return { decadeMap, sortedDecades, undated };
  }, [filtered]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-timeline-heading">
              <Clock className="h-6 w-6 text-primary" />
              Family Timeline
            </h1>
            <p className="text-sm text-muted-foreground">
              Your stories across the decades
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-timeline-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-8">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-4">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <Clock className="h-12 w-12 text-muted-foreground/30 mx-auto" />
              <h3 className="font-semibold" data-testid="text-timeline-empty">No stories to display</h3>
              <p className="text-sm text-muted-foreground">
                {categoryFilter !== "All Categories"
                  ? "Try a different category filter."
                  : "Start writing stories to see them on your timeline."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="relative">
            <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-0.5 bg-border -translate-x-1/2" />

            {grouped.sortedDecades.map((decade) => {
              const decadeStories = grouped.decadeMap[decade];
              return (
                <div key={decade} className="mb-8">
                  <div className="flex justify-center mb-4">
                    <Badge variant="default" className="text-sm px-4 py-1 relative z-10 no-default-active-elevate" data-testid={`badge-decade-${decade}`}>
                      {decade}
                    </Badge>
                  </div>
                  <div className="space-y-4">
                    {decadeStories.map((story, idx) => (
                      <TimelineCard
                        key={story.id}
                        story={story}
                        side={idx % 2 === 0 ? "right" : "left"}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {grouped.undated.length > 0 && (
              <div className="mb-8">
                <div className="flex justify-center mb-4">
                  <Badge variant="secondary" className="text-sm px-4 py-1 relative z-10 no-default-active-elevate" data-testid="badge-decade-undated">
                    Undated
                  </Badge>
                </div>
                <div className="space-y-4">
                  {grouped.undated.map((story, idx) => (
                    <TimelineCard
                      key={story.id}
                      story={story}
                      side={idx % 2 === 0 ? "right" : "left"}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
