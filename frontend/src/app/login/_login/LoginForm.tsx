"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleNotch, Eye, EyeClosed, WarningCircle } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
const authInputClass =
  "h-12 rounded-[8px] border border-[#cddbd0] bg-white/80 px-4 font-sans text-[15px] text-[#12281f] placeholder:text-[#8b9a91] focus-visible:border-[#0f7a5d] focus-visible:shadow-[0_0_0_4px_rgba(15,122,93,0.15)]";
const authLabelClass = "font-sans text-[13px] font-medium text-[#203c31]";
const authMutedClass = "font-sans text-[13px] leading-[1.55] text-[#5d7268]";

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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [failures, setFailures] = useState<number[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [now, setNow] = useState<number>(() => Date.now());
  // persona-10 #5 — when api.ts hits a 401 it stashes a flag in
  // sessionStorage before redirecting here. We read + clear it on mount so
  // the banner appears once per expired session (not on every visit).
  const [sessionExpired, setSessionExpired] = useState(false);

  // Rehydrate failure log from localStorage on mount — client-only.
  useEffect(() => {
    setFailures(pruneFailures(readFailures(), Date.now()));
    try {
      if (sessionStorage.getItem("alphadesk.session_expired") === "1") {
        setSessionExpired(true);
        sessionStorage.removeItem("alphadesk.session_expired");
      }
    } catch {
      // private mode / storage disabled — banner stays hidden, login still works
    }
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

  // Manual override: wipe the client-side lockout log so a user whose
  // localStorage latched `alphadesk.login_failures` (stale state from a
  // prior session, cross-tab pileup) can recover without DevTools.
  // The backend still owns the authoritative rate limit — clearing here
  // just re-enables the Submit button; if the server lockout is still
  // active the POST will 429 and the user sees the Retry-After message.
  const handleResetLockout = useCallback(() => {
    writeFailures([]);
    setFailures([]);
    setError("");
    setNow(Date.now());
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
          body: JSON.stringify({
            username,
            password,
            ...(totpRequired ? { totp_code: totpCode.trim() } : {}),
          }),
          credentials: "include",
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body.detail === "totp_required") {
            setTotpRequired(true);
            setError("Enter your authenticator code to complete sign-in.");
            return;
          }
          setError(body.detail ?? "Invalid username or password");
          const nextList = pruneFailures([...failures, Date.now()], Date.now());
          setFailures(nextList);
          writeFailures(nextList);
          return;
        }

        // Success — clear the failure log
        writeFailures([]);
        setFailures([]);
        setTotpRequired(false);
        setTotpCode("");
        // Also clear any stale session-expired flag — even if the user
        // landed here via expiry, they're now signed back in and the
        // banner shouldn't follow them around.
        try {
          sessionStorage.removeItem("alphadesk.session_expired");
          sessionStorage.setItem("alphadesk.run-tour-after-login", "1");
        } catch {
          // ignore
        }
        const body = await res.json().catch(() => ({}));
        // Hand the refresh token to the scheduler so
        // `ensureTokenRefreshScheduled()` can rotate the access token
        // before its 8-hour TTL expires. See `frontend/src/lib/api.ts`.
        // The api.ts listener also persists this to sessionStorage so
        // the token survives a page reload (persona-9 #2 + persona-10 #2).
        //
        // Wave 3N persona-94 #7: always dispatch the auth event on login
        // success — not just when a refresh token is returned — so
        // listeners like `OnboardingTour` can react to the login itself
        // (e.g. a fresh install shows the tour the first time the user
        // signs in after server reset, even if sessionStorage still had
        // a stale dismissed flag from a prior install).
        window.dispatchEvent(
          new CustomEvent("alphadesk:auth-login-success", {
            detail: body?.refresh_token
              ? { refresh_token: body.refresh_token }
              : {},
          })
        );
        window.location.assign("/");
      } catch {
        setError("Failed to connect to server");
      } finally {
        setLoading(false);
      }
    },
    [failures, locked, password, totpCode, totpRequired, username]
  );

  const failCount = pruneFailures(failures, now).length;
  const disabled = loading || !username || !password || (totpRequired && !totpCode.trim()) || locked;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
      aria-describedby={error ? "login-error" : undefined}
    >
      {/*
        No-JS fallback. Previously the form had `action="#" method="POST"`
        which would silently post credentials to the current URL on submit
        if JS never loaded — flagged by the audit (qa-3a-auth-marketing.md
        P2) as a credential-exposure risk. Without an `action`, browsers
        fall back to the current URL but also surface the native "submit
        did nothing" to the user. This message makes the requirement
        explicit before they try.
      */}
      <noscript>
        <p className="font-sans text-[13px] text-[#5d7268]">
          JavaScript is required to sign in to AlphaDesk.
        </p>
      </noscript>

      <div className="border-b border-[#d7e4d9] pb-5">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0f7a5d]">
          Welcome back
        </p>
        <h2 className="mt-3 font-sans text-[24px] font-semibold leading-tight tracking-tight text-[#12281f]">
          Open your workspace
        </h2>
        <p className={`mt-2 ${authMutedClass}`}>
          Pick up your research, AI reviews, trade plans, and operating history where you left them.
        </p>
      </div>

      {sessionExpired && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-[8px] border border-[#0f7a5d]/[0.24] bg-[#e8f5ea] px-3 py-2 font-sans text-[13px] text-[#0d654d]"
        >
          Your session expired. Please sign in again.
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="login-username" className={authLabelClass}>
          Username
        </label>
        <Input
          id="login-username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setTotpRequired(false);
            setTotpCode("");
          }}
          placeholder="email or desk handle"
          autoComplete="username"
          autoFocus
          className={authInputClass}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <label htmlFor="login-password" className={authLabelClass}>
            Password
          </label>
          <Link
            href="/login/reset"
            className="inline-flex min-h-8 items-center rounded-[6px] px-1 font-sans text-[12px] text-[#5d7268] transition-colors hover:text-[#0f7a5d]"
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Input
            id="login-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setTotpRequired(false);
              setTotpCode("");
            }}
            onKeyDown={handlePasswordKey}
            onKeyUp={handlePasswordKey}
            placeholder="your password"
            autoComplete="current-password"
            className={`${authInputClass} pr-12`}
            aria-invalid={error ? true : undefined}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            // a11y audit r3 — WCAG 2.1.1/2.4.3: previously had tabIndex={-1}
            // which excluded keyboard-only users from revealing their password.
            // type="button" already prevents form submission on Enter, so
            // there's no need to remove it from tab order.
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute grid h-10 w-10 place-items-center rounded-[8px] p-0 text-[#5d7268] transition-colors hover:bg-[#ecf4ed] hover:text-[#0f7a5d] active:scale-[0.98]"
            style={{ right: 4, top: 4 }}
          >
            {showPassword ? (
              <EyeClosed className="h-4 w-4" aria-hidden weight="regular" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden weight="regular" />
            )}
          </button>
        </div>
        {capsLock && (
          <p className="font-sans text-[12px] text-[#8a5c18]">
            Caps lock is on.
          </p>
        )}
      </div>

      {totpRequired && (
        <div className="flex flex-col gap-2">
          <label htmlFor="login-totp" className={authLabelClass}>
            Authenticator code
          </label>
          <Input
            id="login-totp"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            className={`${authInputClass} font-mono`}
          />
        </div>
      )}

      {error && (
        <div
          id="login-error"
          role="alert"
          aria-live="assertive"
          className="inline-flex items-start gap-2 rounded-[8px] border border-[#c95d42]/[0.26] bg-[#fff1ec] px-3 py-2 font-sans text-[13px] leading-[1.45] text-[#8f321f]"
        >
          <WarningCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden weight="regular" />
          {error}
        </div>
      )}

      {locked && (
        <div className="flex flex-col gap-2">
          <p
            role="alert"
            aria-live="assertive"
            className="font-sans text-[13px] text-[#8f321f]"
          >
            Too many attempts. Try again in {formatRemaining(lockoutRemainingMs)}.
          </p>
          <button
            type="button"
            onClick={handleResetLockout}
            className="self-start rounded-[6px] font-sans text-[12px] text-[#5d7268] underline decoration-[#b4c4b9] underline-offset-4 transition-colors hover:text-[#0f7a5d]"
          >
            Reset lockout
          </button>
        </div>
      )}

      {!locked && failCount >= 3 && (
        <p className="font-sans text-[12px] text-[#8a5c18]">
          {LOCKOUT_THRESHOLD - failCount} attempt{LOCKOUT_THRESHOLD - failCount === 1 ? "" : "s"} left before lockout.
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        variant="primary"
        className="mt-1 h-12 w-full rounded-[8px] bg-[#0f7a5d] font-sans text-[15px] font-semibold text-white shadow-[0_18px_38px_-28px_rgba(15,122,93,0.85)] hover:bg-[#0c654d]"
        disabled={disabled}
      >
        {loading ? (
          <CircleNotch className="mr-2 h-4 w-4 animate-spin" aria-hidden weight="regular" />
        ) : (
          <ArrowRight className="mr-2 h-4 w-4" aria-hidden weight="regular" />
        )}
        {totpRequired ? "Verify code" : "Sign in"}
      </Button>

      <p className="mt-1 text-center font-sans text-[13px] text-[#5d7268]">
        No account?{" "}
        <Link
          href="/request-access"
          className="font-medium text-[#0f7a5d] underline decoration-[#93cdb8] underline-offset-4 transition-colors hover:text-[#0c654d]"
        >
          Request access
        </Link>
      </p>
    </form>
  );
}
