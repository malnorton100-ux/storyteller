import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { queryClient } from "@/lib/queryClient";

/** Opened from the "Reset your password" email link: /reset-password?token=... */
export default function ResetPassword() {
  const [, navigate] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      queryClient.clear();
      queryClient.setQueryData(["/api/auth/me"], data);
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-background flex items-start justify-center px-5 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <KeyRound className="h-10 w-10 text-primary mx-auto" />
          <h1 className="font-serif text-2xl font-bold">Choose a new password</h1>
          <p className="text-sm text-muted-foreground">Then you'll be logged straight in.</p>
        </div>
        {!token ? (
          <p className="text-center text-destructive">This link isn't complete. Please open it again from your email.</p>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input id="new-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="input-new-password" />
                  <p className="text-xs text-muted-foreground">At least 8 characters.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Type it again</Label>
                  <Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required data-testid="input-confirm-password" />
                </div>
                {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                <Button type="submit" className="w-full h-11 text-base" disabled={busy} data-testid="button-reset-password">
                  {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save and log in
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
        <p className="text-center text-sm">
          <a href="/" className="text-primary hover:underline">Back to log in</a>
        </p>
      </div>
    </div>
  );
}
