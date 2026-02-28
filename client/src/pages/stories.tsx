import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, Search, Plus, Mic, ShieldCheck, Sparkles, Loader2, Play, Film } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StoryPlayer } from "@/components/story-player";
import type { Story, StoryVideo } from "@shared/schema";

const ERAS = ["All Eras", "1940s", "1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];
const CATEGORIES = ["All Categories", "Childhood", "Family", "Love", "Work", "Travel", "Holidays", "Friendship", "Life Lessons", "Cooking", "Other"];

export default function Stories() {
  const [search, setSearch] = useState("");
  const [eraFilter, setEraFilter] = useState("All Eras");
  const [categoryFilter, setCategoryFilter] = useState("All Categories");
  const [generatingCovers, setGeneratingCovers] = useState<Set<number>>(new Set());
  const [coverGenStarted, setCoverGenStarted] = useState(false);
  const [playingVideo, setPlayingVideo] = useState<{ url: string; title: string; style: string } | null>(null);
  const { toast } = useToast();

  const { data: stories, isLoading } = useQuery<Story[]>({
    queryKey: ["/api/stories"],
  });

  const storyIds = useMemo(() => stories?.map(s => s.id) || [], [stories]);

  const { data: allVideos } = useQuery<Record<number, StoryVideo[]>>({
    queryKey: ["/api/all-story-videos", storyIds.join(",")],
    queryFn: async () => {
      if (storyIds.length === 0) return {};
      const results: Record<number, StoryVideo[]> = {};
      await Promise.all(
        storyIds.map(async (id) => {
          try {
            const res = await fetch(`/api/stories/${id}/videos`);
            const videos = await res.json();
            const completed = (videos as StoryVideo[]).filter(v => v.status === "complete" && v.videoUrl);
            if (completed.length > 0) results[id] = completed;
          } catch {}
        })
      );
      return results;
    },
    enabled: storyIds.length > 0,
  });

  useEffect(() => {
    if (!stories || coverGenStarted) return;
    const withoutCovers = stories.filter(s => !s.coverImageUrl && s.content.length > 30);
    if (withoutCovers.length === 0) return;

    setCoverGenStarted(true);
    setGeneratingCovers(new Set(withoutCovers.map(s => s.id)));

    (async () => {
      for (const story of withoutCovers) {
        try {
          await apiRequest("POST", `/api/stories/${story.id}/cover`);
          setGeneratingCovers(prev => {
            const next = new Set(prev);
            next.delete(story.id);
            return next;
          });
          queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
        } catch {
          setGeneratingCovers(prev => {
            const next = new Set(prev);
            next.delete(story.id);
            return next;
          });
        }
      }
    })();
  }, [stories, coverGenStarted]);

  const filtered = useMemo(() => {
    if (!stories) return [];
    return stories.filter((s) => {
      const matchesSearch = !search || s.title.toLowerCase().includes(search.toLowerCase()) || s.content.toLowerCase().includes(search.toLowerCase());
      const matchesEra = eraFilter === "All Eras" || s.era === eraFilter;
      const matchesCat = categoryFilter === "All Categories" || s.category === categoryFilter;
      return matchesSearch && matchesEra && matchesCat;
    });
  }, [stories, search, eraFilter, categoryFilter]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-1">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-stories-title">My Stories</h1>
            <p className="text-sm text-muted-foreground">
              {stories ? `${stories.length} ${stories.length === 1 ? "story" : "stories"} preserved` : "Loading..."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/record">
              <Button variant="secondary" data-testid="button-stories-record">
                <Mic className="mr-2 h-4 w-4" />
                Record
              </Button>
            </Link>
            <Link href="/new">
              <Button data-testid="button-stories-new">
                <Plus className="mr-2 h-4 w-4" />
                New Story
              </Button>
            </Link>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search stories..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search"
            />
          </div>
          <Select value={eraFilter} onValueChange={setEraFilter}>
            <SelectTrigger className="w-[140px]" data-testid="select-era">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ERAS.map((era) => (
                <SelectItem key={era} value={era}>{era}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
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
        ) : filtered.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((story) => {
              const storyVideos = allVideos?.[story.id];
              const hasVideo = storyVideos && storyVideos.length > 0;

              return (
                <Card key={story.id} className="hover-elevate cursor-pointer h-full" data-testid={`card-story-${story.id}`}>
                  <CardContent className="p-0">
                    <div className="relative">
                      <Link href={`/stories/${story.id}`}>
                        {story.coverImageUrl ? (
                          <img
                            src={story.coverImageUrl}
                            alt={story.title}
                            className="h-40 w-full object-cover rounded-t-md"
                          />
                        ) : generatingCovers.has(story.id) ? (
                          <div className="h-40 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 rounded-t-md flex flex-col items-center justify-center gap-2">
                            <Loader2 className="h-8 w-8 text-primary/50 animate-spin" />
                            <span className="text-xs text-primary/50">Creating cover art...</span>
                          </div>
                        ) : (
                          <div className="h-40 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 rounded-t-md flex items-center justify-center">
                            <BookOpen className="h-10 w-10 text-primary/30" />
                          </div>
                        )}
                      </Link>

                      {hasVideo && (
                        <button
                          className="absolute bottom-2 right-2 bg-black/70 hover:bg-black/90 text-white rounded-full p-2.5 transition-all hover:scale-110 shadow-lg z-10"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const video = storyVideos[0];
                            setPlayingVideo({
                              url: video.videoUrl!,
                              title: story.title,
                              style: video.style,
                            });
                          }}
                          data-testid={`button-play-story-${story.id}`}
                        >
                          <Play className="h-5 w-5" fill="white" />
                        </button>
                      )}

                      {hasVideo && (
                        <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm rounded-md px-2 py-0.5 flex items-center gap-1">
                          <Film className="h-3 w-3 text-white" />
                          <span className="text-white text-xs font-medium">VIDEO</span>
                        </div>
                      )}
                    </div>

                    <Link href={`/stories/${story.id}`}>
                      <div className="p-4 space-y-1">
                        <h3 className="font-semibold truncate" data-testid={`text-story-title-${story.id}`}>{story.title}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {story.content.substring(0, 120)}...
                        </p>
                        <div className="flex flex-wrap gap-1 pt-1">
                          {story.era && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                              {story.era}
                            </span>
                          )}
                          {story.category && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {story.category}
                            </span>
                          )}
                          {story.contentRating && story.contentRating !== "G" && (
                            <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-0.5 ${
                              story.contentRating === "M" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                            }`}>
                              <ShieldCheck className="h-3 w-3" />
                              {story.contentRating}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <BookOpen className="h-12 w-12 text-muted-foreground/30 mx-auto" />
              <h3 className="font-semibold">
                {search || eraFilter !== "All Eras" || categoryFilter !== "All Categories"
                  ? "No stories match your filters"
                  : "No stories yet"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {search || eraFilter !== "All Eras" || categoryFilter !== "All Categories"
                  ? "Try adjusting your search or filters."
                  : "Start by recording or writing your first memory."}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {playingVideo && (
        <StoryPlayer
          videoUrl={playingVideo.url}
          title={playingVideo.title}
          style={playingVideo.style}
          onClose={() => setPlayingVideo(null)}
        />
      )}
    </div>
  );
}
