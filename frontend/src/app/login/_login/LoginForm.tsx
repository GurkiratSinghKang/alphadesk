"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Eyebrow from "@/components/typography/Eyebrow";

/**
 * LoginForm (private to /login)
 * ─────────────────────────────
 * Editorial reskin of the sign-in form. Only the visual shell changes —
 * the POST to `/api/v1/auth/login`, the cookie-based auth flow, and the
 * success redirect to `/` are identical to the pre-F3b behavior.
 *
 * The "Forgot password?" and "Request access" mailto links are preserved
 * as-is — they are pre-existing bugs flagged in the audit; fixing them is
 * out of scope for F3b.
 */
export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [failCount, setFailCount] = useState(0);

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
        setError(body.detail ?? "Invalid username or password");
        setFailCount((c) => c + 1);
        return;
      }

      await res.json();
      router.push("/");
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      method="POST"
      action="#"
      className="flex flex-col gap-5"
      aria-describedby={error ? "login-error" : undefined}
    >
      <div className="flex flex-col gap-1.5">
        <Eyebrow as="div">
          <label htmlFor="login-username">Username</label>
        </Eyebrow>
        <Input
          id="login-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your handle"
          autoComplete="username"
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <Eyebrow as="div">
            <label htmlFor="login-password">Password</label>
          </Eyebrow>
          <a
            href="mailto:support@tradingalpha.net"
            className="font-sans text-[10.5px] text-fg-hint transition-colors hover:text-fg"
            style={{ letterSpacing: "0.01em" }}
          >
            Forgot password?
          </a>
        </div>
        <Input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="at least 12 characters"
          autoComplete="current-password"
        />
      </div>

      {error && (
        <p
          id="login-error"
          role="alert"
          aria-live="assertive"
          className="font-mono text-[11.5px] text-down-500"
        >
          {error}
        </p>
      )}

      {failCount >= 3 && (
        <p className="font-mono text-[11px] text-amber">
          Too many attempts may result in temporary lockout.
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        variant="primary"
        className="mt-1 w-full"
        disabled={loading || !username || !password}
      >
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <ArrowRight className="mr-2 h-4 w-4" />
        )}
        Sign in
      </Button>

      <p className="mt-1 text-center font-display italic text-[13px] text-fg-muted">
        No account?{" "}
        <a
          href="mailto:legal@tradingalpha.net"
          className="text-brand underline decoration-brand-dim underline-offset-4 hover:text-gold-300"
        >
          Request access
        </a>
      </p>
    </form>
  );
}
