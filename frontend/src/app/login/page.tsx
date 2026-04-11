"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
      const res = await fetch(`${apiBase}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail ?? "Invalid credentials");
        return;
      }

      await res.json();
      // HttpOnly cookies are set by the backend via Set-Cookie headers
      // No need to store tokens in JS-accessible cookies
      router.push("/");
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full max-w-sm space-y-6 rounded-2xl border border-border/50 bg-[var(--surface)]/80 p-8 backdrop-blur-sm shadow-2xl shadow-black/20">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
          <Zap className="h-6 w-6 text-primary" />
        </div>
        <div className="text-center">
          <h1 className="text-xl font-bold text-foreground tracking-tight">AlphaDesk</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your trading terminal</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-username" className="text-xs text-muted-foreground">Username</label>
          <Input
            id="login-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            className="mt-1"
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="login-password" className="text-xs text-muted-foreground">Password</label>
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="mt-1"
          />
        </div>

        {error && (
          <p className="text-xs text-[var(--loss)]">{error}</p>
        )}

        <Button type="submit" className="w-full" disabled={loading || !username || !password}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Sign In
        </Button>
      </form>
    </div>
  );
}
