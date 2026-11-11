import { Film, BookOpen, Sparkles, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type UnlockNeeds = "pictures" | "movie";

type Product = { id: string; price_id: string; unit_amount: number | null; currency?: string; metadata?: { type?: string } };

const INFO: Record<string, { title: string; text: string; icon: typeof Film }> = {
  video_download: { title: "Movie", text: "Your story as a movie with you as the star. Up to 3 goes, and you keep the download.", icon: Film },
  pdf_download: { title: "Storybook", text: "More storybook pictures (up to 5 goes) and a printable book to keep.", icon: BookOpen },
  bundle_download: { title: "Everything", text: "The movie AND the storybook: pictures, movie and printable book.", icon: Sparkles },
};

const ORDER: Record<UnlockNeeds, string[]> = {
  movie: ["bundle_download", "video_download"],
  pictures: ["pdf_download", "bundle_download", "video_download"],
};

function money(p: Product) {
  if (p.unit_amount == null) return "";
  const cur = (p.currency || "usd").toUpperCase();
  return `${cur === "AUD" ? "A$" : cur === "USD" ? "US$" : cur + " "}${(p.unit_amount / 100).toFixed(2)}`;
}

/** Shown when someone tries to make something this story hasn't been unlocked for. */
export function UnlockDialog({
  open,
  onOpenChange,
  needs,
  usedUp,
  products,
  onBuy,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  needs: UnlockNeeds;
  usedUp?: boolean;
  products: Product[] | undefined;
  onBuy: (priceId: string, productType: string) => void;
  pending: boolean;
}) {
  const list = ORDER[needs]
    .map((type) => (products || []).find((p) => p.metadata?.type === type))
    .filter(Boolean) as Product[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto w-[calc(100%-1.5rem)] rounded-lg p-5">
        <DialogHeader className="text-left">
          <DialogTitle className="font-serif text-xl flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            {needs === "movie" ? "Unlock your movie" : "Unlock more pictures"}
          </DialogTitle>
          <DialogDescription className="text-base">
            {usedUp
              ? "You've used all the goes for this story. Unlock it again to keep going."
              : needs === "movie"
                ? "One payment for this story and we'll make your movie, with you as the star."
                : "Your free storybook has been used. Unlock this story to keep making pictures."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          {list.length === 0 && (
            <p className="text-sm text-muted-foreground">Payments aren't set up yet. Please try again later.</p>
          )}
          {list.map((p, i) => {
            const type = p.metadata?.type || "";
            const info = INFO[type] || { title: "Unlock", text: "", icon: Sparkles };
            const Icon = info.icon;
            return (
              <div key={p.id} className={`rounded-lg border p-4 space-y-3 ${i === 0 ? "border-primary bg-primary/5" : ""}`} data-testid={`unlock-${type}`}>
                <div className="flex items-start gap-3">
                  <Icon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-semibold">{info.title}</p>
                      <p className="font-semibold">{money(p)}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">{info.text}</p>
                  </div>
                </div>
                <Button
                  className="w-full h-11 text-base"
                  variant={i === 0 ? "default" : "outline"}
                  disabled={pending}
                  onClick={() => onBuy(p.price_id, type)}
                  data-testid={`button-unlock-${type}`}
                >
                  {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Unlock {info.title.toLowerCase()}: {money(p)}
                </Button>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground text-center">Secure payment by Stripe. One-off, no subscription.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
