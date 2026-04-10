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

      const data = await res.json();

      // Store tokens in cookies
      document.cookie = `access_token=${data.access_token}; path=/; max-age=${data.expires_in}; SameSite=Strict; Secure`;
      document.cookie = `refresh_token=${data.refresh_token}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Strict; Secure`;

      router.push("/");
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm space-y-6 p-6">
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold text-foreground">AlphaDesk</span>
        </div>
        <p className="text-sm text-muted-foreground">Sign in to your trading terminal</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs text-muted-foreground">Username</label>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            className="mt-1"
            autoFocus
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Password</label>
          <Input
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
