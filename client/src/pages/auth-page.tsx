import { useState } from "react";
import { BookOpen, Loader2, Mic, Palette, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

export default function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === "register";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isRegister) await register({ name, email, password });
      else await login({ email, password });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-background">
      {/* Story side */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-primary/15 via-primary/5 to-background border-r">
        <div className="flex items-center gap-2">
          <BookOpen className="h-7 w-7 text-primary" />
          <span className="text-xl font-bold tracking-tight">Storyteller</span>
        </div>
        <div className="space-y-6 max-w-md">
          <h1 className="font-serif text-4xl leading-tight font-bold">
            The stories only you can tell, kept for the people who come next.
          </h1>
          <ul className="space-y-4 text-muted-foreground">
            <li className="flex gap-3"><Mic className="h-5 w-5 text-primary shrink-0 mt-0.5" />Talk or type your memories - no writing skills needed.</li>
            <li className="flex gap-3"><Palette className="h-5 w-5 text-primary shrink-0 mt-0.5" />We turn them into illustrated storybooks and short films, with you in them.</li>
            <li className="flex gap-3"><Gift className="h-5 w-5 text-primary shrink-0 mt-0.5" />Share them with family, or print a keepsake book.</li>
          </ul>
        </div>
        <p className="text-sm text-muted-foreground">Every story matters.</p>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="lg:hidden flex items-center gap-2 justify-center">
            <BookOpen className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold tracking-tight">Storyteller</span>
          </div>
          <div className="space-y-1 text-center">
            <h2 className="font-serif text-2xl font-bold" data-testid="text-auth-title">
              {isRegister ? "Create your account" : "Welcome back"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isRegister ? "Your stories stay private until you choose to share them." : "Log in to see your stories."}
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
                </div>

                {error && (
                  <p className="text-sm text-destructive" role="alert" data-testid="text-auth-error">{error}</p>
                )}

                <Button type="submit" className="w-full" disabled={busy} data-testid="button-auth-submit">
                  {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {isRegister ? "Create account" : "Log in"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="text-center text-sm text-muted-foreground">
            {isRegister ? "Already have an account?" : "New here?"}{" "}
            <button
              type="button"
              className="text-primary font-medium hover:underline"
              onClick={() => { setMode(isRegister ? "login" : "register"); setError(null); }}
              data-testid="button-auth-switch"
            >
              {isRegister ? "Log in" : "Create an account"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
