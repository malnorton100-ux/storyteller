import { useRef, useState } from "react";
import { BookOpen, Loader2, Mic, Clapperboard, Heart, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { PricingSection } from "@/components/pricing-section";

// Showcase movie shown at the top of the landing page.
// Drop the file into client/public/showcase.mp4 (and optionally showcase.jpg as the poster).
// If the file is missing the video block hides itself, so the page still works.
const SHOWCASE_VIDEO = "/showcase.mp4";
const SHOWCASE_POSTER = "/showcase.jpg";

const STEPS = [
  {
    icon: Mic,
    title: "Talk",
    text: "Tell a story from any time in your life, like being a kid, your first job, or the day you moved to a new country.",
  },
  {
    icon: Clapperboard,
    title: "We make it",
    text: "Your story becomes a short movie set in your era, with you as the star.",
  },
  {
    icon: Heart,
    title: "Share it",
    text: "Share it with family and friends so they can see the moment for themselves.",
  },
];

function ShowcaseVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <div className="relative w-full overflow-hidden rounded-xl border bg-black shadow-lg aspect-video">
      <video
        ref={ref}
        src={SHOWCASE_VIDEO}
        poster={SHOWCASE_POSTER}
        autoPlay
        muted={muted}
        loop
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
        data-testid="video-showcase"
      />
      <button
        type="button"
        onClick={() => {
          const next = !muted;
          setMuted(next);
          if (ref.current) {
            ref.current.muted = next;
            if (!next) ref.current.play().catch(() => {});
          }
        }}
        className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur"
        data-testid="button-showcase-sound"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        {muted ? "Tap for sound" : "Sound on"}
      </button>
    </div>
  );
}

export default function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register" | "forgot">("register");
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Testers get a link like /?code=YARDFRIENDS, which fills this in for them.
  const [inviteCode, setInviteCode] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("code") || ""; } catch { return ""; }
  });
  const [showInvite, setShowInvite] = useState(() => !!inviteCode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const isRegister = mode === "register";

  function goToForm(next: "login" | "register") {
    setMode(next);
    setError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "forgot") {
        const res = await fetch("/api/auth/forgot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
        setNotice(data.message || "Check your email for a link to reset your password.");
        return;
      }
      if (isRegister) await register({ name, email, password, inviteCode: inviteCode.trim() || undefined });
      else await login({ email, password });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 py-4 max-w-5xl mx-auto">
        <div className="flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold tracking-tight">Storyteller</span>
        </div>
        <button
          type="button"
          onClick={() => goToForm("login")}
          className="text-sm font-medium text-primary hover:underline"
          data-testid="button-header-login"
        >
          Log in
        </button>
      </header>

      {/* Hero */}
      <section className="px-5 pt-4 pb-10 bg-gradient-to-b from-primary/10 via-primary/5 to-background">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <div className="space-y-3">
            <h1 className="font-serif text-4xl sm:text-5xl font-bold leading-tight" data-testid="text-hero-title">
              Storyteller
            </h1>
            <p className="font-serif text-xl sm:text-2xl text-muted-foreground leading-snug" data-testid="text-hero-byline">
              Tell your story. We'll make the movie.
            </p>
          </div>

          <ShowcaseVideo />

          <div className="space-y-3">
            <Button
              size="lg"
              className="w-full sm:w-auto px-10 text-base h-12"
              onClick={() => goToForm("register")}
              data-testid="button-hero-cta"
            >
              Make my movie
            </Button>
            <p className="text-base font-medium">No photos needed. Just your memories.</p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-5 py-10">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-serif text-2xl font-bold text-center mb-8">How it works</h2>
          <ol className="grid gap-6 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex sm:flex-col gap-4 sm:items-center sm:text-center">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <step.icon className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-lg">{i + 1}. {step.title}</p>
                  <p className="text-muted-foreground">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <PricingSection />

      {/* Why it matters */}
      <section className="px-5 py-10 bg-primary/5">
        <div className="max-w-2xl mx-auto text-center space-y-2">
          <p className="font-serif text-2xl leading-snug">
            The grandkids ask, "What did you do when you were little?"
          </p>
          <p className="font-serif text-2xl font-bold text-primary">Now you can show them.</p>
        </div>
      </section>

      {/* Sign up / log in */}
      <section ref={formRef} className="px-5 py-12 scroll-mt-4">
        <div className="w-full max-w-sm mx-auto space-y-6">
          <div className="space-y-1 text-center">
            <h2 className="font-serif text-2xl font-bold" data-testid="text-auth-title">
              {isRegister ? "Start your first story" : mode === "forgot" ? "Reset your password" : "Welcome back"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isRegister
                ? "It takes about 5 minutes. Your stories stay private until you choose to share them."
                : mode === "forgot" ? "No worries, it happens to everyone." : "Log in to see your stories."}
            </p>
          </div>

          <Card>
            <CardContent className="pt-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                {isRegister && (
                  <div className="space-y-2">
                    <Label htmlFor="name">Your name</Label>
                    <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required data-testid="input-name" />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="input-email" />
                </div>
                {mode !== "forgot" && (
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    minLength={isRegister ? 8 : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    data-testid="input-password"
                  />
                  {isRegister && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
                  {mode === "login" && (
                    <button
                      type="button"
                      className="text-sm text-primary hover:underline"
                      onClick={() => { setMode("forgot"); setError(null); setNotice(null); }}
                      data-testid="button-forgot-password"
                    >
                      Forgot your password?
                    </button>
                  )}
                </div>
                )}
                {isRegister && (showInvite ? (
                  <div className="space-y-2">
                    <Label htmlFor="invite">Invite code</Label>
                    <Input id="invite" autoCapitalize="characters" autoComplete="off" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} data-testid="input-invite-code" />
                    <p className="text-xs text-muted-foreground">Only if someone gave you one. Testers get everything free.</p>
                  </div>
                ) : (
                  <button type="button" className="text-sm text-primary hover:underline" onClick={() => setShowInvite(true)} data-testid="button-show-invite">
                    Have an invite code?
                  </button>
                ))}
                {mode === "forgot" && (
                  <p className="text-sm text-muted-foreground">Type the email you signed up with and we'll send you a link to choose a new password.</p>
                )}
                {notice && (
                  <p className="text-sm text-green-700 dark:text-green-400" role="status" data-testid="text-auth-notice">{notice}</p>
                )}

                {error && (
                  <p className="text-sm text-destructive" role="alert" data-testid="text-auth-error">{error}</p>
                )}

                <Button type="submit" className="w-full h-11 text-base" disabled={busy} data-testid="button-auth-submit">
                  {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {isRegister ? "Start my story" : mode === "forgot" ? "Send reset link" : "Log in"}
                </Button>
                {isRegister && (
                  <p className="text-xs text-muted-foreground text-center">
                    By signing up you agree to our <a href="/terms" className="underline">Terms</a> and <a href="/privacy" className="underline">Privacy policy</a>.
                  </p>
                )}
              </form>
            </CardContent>
          </Card>

          <p className="text-center text-sm text-muted-foreground">
            {isRegister ? "Already have an account?" : mode === "forgot" ? "Remembered it?" : "New here?"}{" "}
            <button
              type="button"
              className="text-primary font-medium hover:underline"
              onClick={() => { setMode(isRegister || mode === "forgot" ? "login" : "register"); setError(null); setNotice(null); }}
              data-testid="button-auth-switch"
            >
              {isRegister || mode === "forgot" ? "Log in" : "Create an account"}
            </button>
          </p>
        </div>
      </section>

      <footer className="px-5 pb-8 text-center text-sm text-muted-foreground space-y-2">
        <p>Every story matters.</p>
        <p>
          <a href="/privacy" className="hover:underline">Privacy</a> · <a href="/terms" className="hover:underline">Terms</a>
        </p>
      </footer>
    </div>
  );
}
