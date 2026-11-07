import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  /** e.g. "Making your movie" */
  title: string;
  /** e.g. "Bringing each scene to life" */
  stepLabel: string;
  done: number;
  total: number;
  /** When the work started (for the elapsed timer). */
  startedAt: number;
  /** Rough total time in minutes, shown as a guide. */
  usualMinutes: number;
  onCancel?: () => void;
  testId?: string;
};

function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m} min ${r.toString().padStart(2, "0")} sec` : `${r} sec`;
}

/**
 * A big, can't-miss "we're working on it" banner that stays pinned to the top
 * of the page while the AI is busy. Written for older users: large text,
 * plain words, a moving progress bar, a running clock and reassurance.
 */
export function WorkingBanner({ title, stepLabel, done, total, startedAt, usualMinutes, onCancel, testId }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const safeTotal = Math.max(total, done, 1);
  // Never show 0% (looks stuck) or 100% (not finished yet).
  const pct = Math.min(95, Math.max(5, Math.round((done / safeTotal) * 100)));
  const elapsed = now - startedAt;
  const overTime = elapsed > usualMinutes * 60 * 1000 * 1.5;

  return (
    <div
      className="sticky top-2 z-30 rounded-xl border-2 border-primary bg-background shadow-lg p-5 space-y-4"
      role="status"
      aria-live="polite"
      data-testid={testId}
    >
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xl font-bold leading-tight">{title}…</p>
          <p className="text-base text-foreground/80 mt-1">
            {stepLabel}: <span className="font-semibold">{Math.min(done + 1, safeTotal)} of {safeTotal}</span>
          </p>
        </div>
      </div>

      <div className="h-4 w-full rounded-full bg-primary/15 overflow-hidden" aria-hidden="true">
        <div
          className="h-full rounded-full bg-primary transition-all duration-700 relative overflow-hidden"
          style={{ width: `${pct}%` }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-pulse" />
        </div>
      </div>

      <div className="text-base space-y-1">
        <p>
          ⏱ Working for <span className="font-semibold">{formatElapsed(elapsed)}</span>
          <span className="text-foreground/70"> · usually about {usualMinutes} minutes</span>
        </p>
        <p className="text-foreground/80">
          {overTime
            ? "This one is taking a little longer than usual — it's still going."
            : "It's safe to leave this page. We'll keep working and it will be here when you come back."}
        </p>
      </div>

      {onCancel && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={onCancel} className="text-base h-11" data-testid={testId ? `${testId}-cancel` : undefined}>
            <X className="h-5 w-5 mr-1" />
            Stop
          </Button>
        </div>
      )}
    </div>
  );
}
