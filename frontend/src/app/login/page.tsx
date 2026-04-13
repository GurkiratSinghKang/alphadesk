"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  Loader2,
  Brain,
  Layers,
  Activity,
  ShieldCheck,
  ArrowRight,
  Mail,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const features = [
  {
    icon: Brain,
    title: "AI Analysis",
    description:
      "Claude-powered market analysis with real-time sentiment scoring and trade recommendations.",
  },
  {
    icon: Layers,
    title: "Multi-Strategy Pipeline",
    description:
      "Run parallel strategies across equities and options with automated signal generation.",
  },
  {
    icon: Activity,
    title: "Real-Time Trading",
    description:
      "Live order execution through Alpaca with position tracking, P&L monitoring, and risk controls.",
  },
  {
    icon: ShieldCheck,
    title: "Portfolio Management",
    description:
      "Comprehensive portfolio analytics, calendar P&L, and exposure management in one terminal.",
  },
];

export default function LoginPage() {
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
    <div className="flex min-h-screen w-full flex-col">
      {/* Main content: hero + login */}
      <div className="flex flex-1 flex-col items-center justify-center gap-12 px-4 py-12 lg:flex-row lg:gap-20 lg:px-16">
        {/* Left: hero + features */}
        <div className="w-full max-w-xl space-y-8 text-center lg:text-left">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              <Zap className="h-3 w-3" />
              AI-Powered Trading Terminal
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              AlphaDesk
            </h1>
            <p className="text-lg text-muted-foreground">
              Institutional-grade trading terminal powered by Claude AI.
              Multi-strategy pipeline, real-time execution, and automated
              portfolio management — all in one platform.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="card-glow rounded-xl border border-border/50 bg-[var(--surface)]/60 p-4 text-left backdrop-blur-sm"
              >
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                  <feature.icon className="h-4 w-4 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">
                  {feature.title}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground lg:justify-start">
            <a
              href="mailto:legal@tradingalpha.net"
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <Mail className="h-3.5 w-3.5" />
              Request Access
            </a>
            <span className="text-border">|</span>
            <span>Invite-only platform</span>
          </div>
        </div>

        {/* Right: login form */}
        <div className="w-full max-w-sm mx-4">
          <div className="space-y-6 rounded-2xl border border-border/50 bg-[var(--surface)]/80 p-8 backdrop-blur-sm shadow-2xl shadow-black/20">
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <div className="text-center">
                <h2 className="text-xl font-bold text-foreground tracking-tight">
                  Sign In
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Access your trading terminal
                </p>
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              method="POST"
              action="#"
              className="space-y-4"
              aria-describedby={error ? "login-error" : undefined}
            >
              <div>
                <label
                  htmlFor="login-username"
                  className="text-xs text-muted-foreground"
                >
                  Username
                </label>
                <Input
                  id="login-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  className="mt-1"
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="login-password"
                    className="text-xs text-muted-foreground"
                  >
                    Password
                  </label>
                  <a
                    href="mailto:support@tradingalpha.net"
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Forgot password?
                  </a>
                </div>
                <Input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="mt-1"
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <p
                  id="login-error"
                  role="alert"
                  aria-live="assertive"
                  className="text-xs text-[var(--loss)]"
                >
                  {error}
                </p>
              )}

              {failCount >= 3 && (
                <p className="text-[11px] text-amber-400">
                  Too many attempts may result in temporary lockout.
                </p>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={loading || !username || !password}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="mr-2 h-4 w-4" />
                )}
                Sign In
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border/30 px-4 py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} AlphaDesk. All rights reserved.
          </p>
          <nav className="flex gap-4 text-xs text-muted-foreground">
            <Link href="/docs" className="hover:text-foreground">
              Docs
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms of Service
            </Link>
            <Link href="/risk" className="hover:text-foreground">
              Risk Disclosure
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
