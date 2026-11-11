import { useQuery } from "@tanstack/react-query";
import { Gift, BookOpen, Film, Sparkles, Check } from "lucide-react";

type Product = { id: string; unit_amount: number | null; currency?: string; metadata?: { type?: string } };

export function formatPrice(p?: Product | null): string {
  if (!p || p.unit_amount == null) return "";
  const cur = (p.currency || "aud").toUpperCase();
  return `${cur === "AUD" ? "A$" : cur === "USD" ? "US$" : cur + " "}${(p.unit_amount / 100).toFixed(2)}`;
}

/** Live prices from Stripe (public - works before logging in). */
export function useStoryPrices() {
  const { data } = useQuery<Product[]>({
    queryKey: ["/api/stripe/products"],
    queryFn: async () => {
      const res = await fetch("/api/stripe/products");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });
  const byType = (t: string) => (data || []).find((p) => p.metadata?.type === t);
  return {
    storybook: byType("pdf_download"),
    movie: byType("video_download"),
    everything: byType("bundle_download"),
  };
}

const ROWS = [
  { key: "storybook" as const, icon: BookOpen, title: "Storybook", text: "More pictures for your story, plus a printable book to keep." },
  { key: "movie" as const, icon: Film, title: "Movie", text: "Your story as a movie, with you as the star, narrated in your voice." },
  { key: "everything" as const, icon: Sparkles, title: "Everything", text: "The storybook and the movie together.", best: true },
];

/** "What does it cost?" - shown on the front page so there are no surprises. */
export function PricingSection() {
  const prices = useStoryPrices();
  const any = prices.storybook || prices.movie || prices.everything;
  const saving =
    prices.storybook?.unit_amount && prices.movie?.unit_amount && prices.everything?.unit_amount
      ? (prices.storybook.unit_amount + prices.movie.unit_amount - prices.everything.unit_amount) / 100
      : 0;

  return (
    <section className="px-5 py-10" data-testid="section-pricing">
      <div className="max-w-xl mx-auto space-y-4">
        <h2 className="font-serif text-2xl font-bold text-center">What does it cost?</h2>

        <div className="rounded-xl border-2 border-primary bg-primary/5 p-4 flex gap-3 items-start">
          <Gift className="h-6 w-6 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-lg">Your first storybook is free</p>
            <p className="text-muted-foreground">Tell a story and see yourself in it. No card needed.</p>
          </div>
        </div>

        {any && (
          <>
            <p className="text-center text-muted-foreground pt-2">Love it? Pay once for each story:</p>
            <div className="space-y-3">
              {ROWS.map((r) => {
                const p = prices[r.key];
                if (!p) return null;
                return (
                  <div key={r.key} className={`rounded-xl border p-4 flex gap-3 items-start ${r.best ? "border-primary" : ""}`} data-testid={`price-${r.key}`}>
                    <r.icon className="h-5 w-5 text-primary shrink-0 mt-1" />
                    <div className="flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold text-lg">
                          {r.title}
                          {r.best && <span className="ml-2 text-xs font-medium bg-primary text-primary-foreground rounded-full px-2 py-0.5 align-middle">Best value</span>}
                        </p>
                        <p className="font-semibold text-lg">{formatPrice(p)}</p>
                      </div>
                      <p className="text-muted-foreground">
                        {r.text}
                        {r.best && saving > 0 ? ` Save $${saving.toFixed(2)}.` : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <ul className="text-sm text-muted-foreground space-y-1 pt-1">
          {["One-off payment. No subscription.", "Only pay for the stories you love.", "Secure payment by Stripe."].map((t) => (
            <li key={t} className="flex gap-2 items-center"><Check className="h-4 w-4 text-primary" />{t}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
