"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Eyebrow from "@/components/typography/Eyebrow";

/**
 * LoginForm (private to /login)
 * ─────────────────────────────
 * Editorial reskin of the sign-in form. Auth flow (POST to
 * `/api/v1/auth/login`, cookie-based session, redirect to `/`) is unchanged.
 *
 * Audit P0-8 removed the `mailto:` links — "Forgot password?" now routes to
 * `/login/reset` and "Request access" to `/request-access`.
 *
 * Audit P0-9 adds three basic credential-entry affordances:
 *   • Password show/hide toggle (Eye / EyeOff icon button)
 *   • Caps-lock detection via `event.getModifierState("CapsLock")`
 *   • Client-side lockout: 5 failed attempts in a rolling 10-minute window
 *     disables the submit button with a live countdown. The backend also
 *     rate-limits — this is just the UX reflection, not the source of truth.
 */

const LOCKOUT_STORAGE_KEY = "alphadesk.login_failures";
const LOCKOUT_WINDOW_MS = 10 * 60 * 1000; // 10 min rolling window
const LOCKOUT_THRESHOLD = 5; // failures that trigger the lockout

function readFailures(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCKOUT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  } catch {
    return [];
  }
}

function writeFailures(list: number[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCKOUT_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage may be unavailable (private mode, storage quota)
  }
}

function pruneFailures(list: number[], now: number): number[] {
  return list.filter((t) => now - t < LOCKOUT_WINDOW_MS);
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [failures, setFailures] = useState<number[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());

  // Rehydrate failure log from localStorage on mount — client-only.
  useEffect(() => {
    setFailures(pruneFailures(readFailures(), Date.now()));
  }, []);

  // Tick while locked out so the countdown stays accurate.
  const locked = useMemo(() => {
    const recent = pruneFailures(failures, now);
    return recent.length >= LOCKOUT_THRESHOLD;
  }, [failures, now]);

  const lockoutRemainingMs = useMemo(() => {
    if (!locked) return 0;
    const recent = pruneFailures(failures, now);
    if (recent.length === 0) return 0;
    const oldest = Math.min(...recent);
    return Math.max(0, LOCKOUT_WINDOW_MS - (now - oldest));
  }, [failures, locked, now]);

  useEffect(() => {
    if (!locked) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [locked]);

  // Detect caps-lock on key events so we can surface a subtle warning.
  const handlePasswordKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") {
      setCapsLock(e.getModifierState("CapsLock"));
    }
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (locked) return;
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
          const nextList = pruneFailures([...failures, Date.now()], Date.now());
          setFailures(nextList);
          writeFailures(nextList);
          return;
        }

        // Success — clear the failure log
        writeFailures([]);
        setFailures([]);
        await res.json();
        router.push("/");
      } catch {
        setError("Failed to connect to server");
      } finally {
        setLoading(false);
      }
    },
    [failures, locked, password, router, username]
  );

  const failCount = pruneFailures(failures, now).length;
  const disabled = loading || !username || !password || locked;

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
          <Link
            href="/login/reset"
            className="font-sans text-[10.5px] text-fg-hint transition-colors hover:text-fg"
            style={{ letterSpacing: "0.01em" }}
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Input
            id="login-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handlePasswordKey}
            onKeyUp={handlePasswordKey}
            placeholder="at least 12 characters"
            autoComplete="current-password"
            className="pr-10"
            aria-invalid={error ? true : undefined}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
            tabIndex={-1}
          >
            {showPassword ? (
              <EyeOff className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Eye className="h-3.5 w-3.5" aria-hidden />
            )}
          </Button>
        </div>
        {capsLock && (
          <p className="font-display italic text-[11.5px] text-amber">
            Caps lock is on.
          </p>
        )}
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

      {locked && (
        <p
          role="alert"
          aria-live="assertive"
          className="font-mono text-[11.5px] text-down-500"
        >
          Too many attempts. Try again in {formatRemaining(lockoutRemainingMs)}.
        </p>
      )}

      {!locked && failCount >= 3 && (
        <p className="font-mono text-[11px] text-amber">
          {LOCKOUT_THRESHOLD - failCount} attempt{LOCKOUT_THRESHOLD - failCount === 1 ? "" : "s"} left before lockout.
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        variant="primary"
        className="mt-1 w-full"
        disabled={disabled}
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
        <Link
          href="/request-access"
          className="text-brand underline decoration-brand-dim underline-offset-4 hover:text-gold-300"
        >
          Request access
        </Link>
      </p>
    </form>
  );
}
