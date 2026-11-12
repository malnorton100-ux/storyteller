import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

/** Owner-only tools. The server refuses these for anyone else. */
export default function OwnerPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/owner/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404 && !data.error?.startsWith("No account")) {
        setMsg({ ok: false, text: "Only the app owner can use this. Log in with your main account." });
      } else if (!res.ok) {
        setMsg({ ok: false, text: data.error || "Something went wrong." });
      } else {
        setMsg({ ok: true, text: data.message });
      }
    } catch {
      setMsg({ ok: false, text: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-serif font-bold">Owner tools</h1>
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted-foreground">Set a new password for any account (e.g. a locked-out tester).</p>
            <div className="space-y-2">
              <Label htmlFor="owner-email">Account email</Label>
              <Input id="owner-email" type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner-pw">New password</Label>
              <Input id="owner-pw" type="text" autoCapitalize="none" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Set password
            </Button>
            {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-destructive"}`}>{msg.text}</p>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
