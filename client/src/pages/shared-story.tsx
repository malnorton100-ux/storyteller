import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, ChevronLeft, ChevronRight, Gift, Heart } from "lucide-react";
import { useState } from "react";
import type { Story, Illustration } from "@shared/schema";

type SharedStory = Story & { illustrations: Illustration[] };

export default function SharedStory() {
  const [, params] = useRoute("/shared/:token");
  const token = params?.token || "";
  const [currentPage, setCurrentPage] = useState(0);

  const { data: story, isLoading } = useQuery<SharedStory>({
    queryKey: ["/api/shared", token],
    enabled: !!token,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20">
        <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">
          <Skeleton className="h-12 w-64 mx-auto" />
          <Skeleton className="h-[400px] w-full rounded-md" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (!story) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 flex items-center justify-center">
        <div className="text-center space-y-4 px-4">
          <BookOpen className="h-16 w-16 text-amber-400/50 mx-auto" />
          <h1 className="text-2xl font-serif font-bold text-foreground" data-testid="text-not-found">Story Not Found</h1>
          <p className="text-muted-foreground">This shared story link may have expired or is invalid.</p>
          <Link href="/">
            <Button variant="outline" data-testid="button-go-home">Go to Storyteller</Button>
          </Link>
        </div>
      </div>
    );
  }

  const sorted = story.illustrations
    ? [...story.illustrations].sort((a, b) => (a.sceneOrder || 0) - (b.sceneOrder || 0))
    : [];

  const hasIllustrations = sorted.length > 0;
  const currentIll = sorted[currentPage];
  const contentParagraphs = story.content.split("\n").filter(p => p.trim());

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {story.giftMessage && (
          <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40" data-testid="card-gift-message">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center flex-shrink-0">
                  <Gift className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">A Gift For You</p>
                  <p className="text-sm text-foreground leading-relaxed italic" data-testid="text-gift-message">"{story.giftMessage}"</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2">
            <Heart className="h-4 w-4 text-amber-500" />
            <span className="text-xs font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">A Shared Story</span>
            <Heart className="h-4 w-4 text-amber-500" />
          </div>
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground" data-testid="text-story-title">{story.title}</h1>
          {(story.era || story.category) && (
            <p className="text-sm text-muted-foreground" data-testid="text-story-meta">
              {[story.era, story.category].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>

        {hasIllustrations && (
          <Card className="overflow-hidden" data-testid="card-illustration-slideshow">
            <CardContent className="p-0">
              <div className="relative">
                <img
                  src={currentIll.imageUrl}
                  alt={currentIll.sceneCaption || `Scene ${currentPage + 1}`}
                  className="w-full aspect-[16/10] object-cover"
                  data-testid={`img-shared-scene-${currentPage + 1}`}
                />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
                  <p className="text-white text-sm font-medium leading-snug">
                    {currentIll.customText || currentIll.sceneCaption || `Scene ${currentPage + 1}`}
                  </p>
                </div>
                {sorted.length > 1 && (
                  <>
                    <button
                      onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                      className={`absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full p-1.5 transition-opacity ${currentPage === 0 ? "opacity-30 pointer-events-none" : "opacity-100"}`}
                      data-testid="button-shared-prev"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => setCurrentPage(Math.min(sorted.length - 1, currentPage + 1))}
                      className={`absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full p-1.5 transition-opacity ${currentPage === sorted.length - 1 ? "opacity-30 pointer-events-none" : "opacity-100"}`}
                      data-testid="button-shared-next"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                )}
              </div>
              {sorted.length > 1 && (
                <div className="flex gap-1.5 justify-center p-3">
                  {sorted.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentPage(idx)}
                      className={`w-2 h-2 rounded-full transition-colors ${idx === currentPage ? "bg-primary" : "bg-muted-foreground/30"}`}
                      data-testid={`dot-shared-scene-${idx + 1}`}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card data-testid="card-story-content">
          <CardContent className="p-6 md:p-8">
            <div className="prose prose-amber dark:prose-invert max-w-none">
              {contentParagraphs.map((paragraph, idx) => (
                <p key={idx} className="text-base leading-relaxed text-foreground mb-4 last:mb-0 font-serif">
                  {paragraph}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="text-center space-y-4 pt-4 pb-8">
          <div className="w-12 h-px bg-amber-300 dark:bg-amber-700 mx-auto" />
          <p className="text-xs text-muted-foreground">
            Shared with love via <span className="font-semibold text-amber-600 dark:text-amber-400">Storyteller</span>
          </p>
          <Link href="/">
            <Button variant="outline" size="sm" data-testid="button-create-your-own">
              <BookOpen className="mr-2 h-4 w-4" />
              Create Your Own Story
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
