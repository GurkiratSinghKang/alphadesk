"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  GearSix,
  Keyboard,
  ShieldCheck,
  SignOut,
  UsersThree,
} from "@phosphor-icons/react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import DestructiveConfirmModal from "@/components/destructive/DestructiveConfirmModal";
import { useDestructiveAction } from "@/components/destructive/useDestructiveAction";
import { usePreferencesStore, type ThemePreference } from "@/stores/preferences";
import { usePortfolioStore } from "@/stores/portfolio";
import { formatCurrency, cn } from "@/lib/utils";
import { env } from "@/env";
import { clearPersistedStores } from "@/lib/auth/clearPersistedStores";

/** Best-effort JWT payload read for the displayed username. */
function decodeJwtSub(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )access_token=([^;]*)/);
  const token = match?.[1];
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof payload.sub === "string" && payload.sub.trim()) return payload.sub;
    if (typeof payload.email === "string" && payload.email.trim()) return payload.email;
    if (typeof payload.username === "string" && payload.username.trim()) return payload.username;
    return null;
  } catch {
    return null;
  }
}

export function ProfileMenu() {
  const router = useRouter();
  const theme = usePreferencesStore((s) => s.display.theme);
  const setDisplayPref = usePreferencesStore((s) => s.setDisplayPref);
  const summary = usePortfolioStore((s) => s.summary);
  const destructive = useDestructiveAction();

  // Resolve display name from JWT once per mount — HttpOnly cookies are not
  // readable, so this is best-effort and falls back to "Account".
  const [displayName, setDisplayName] = useState<string>("Account");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const sub = decodeJwtSub();
      if (sub) setDisplayName(sub);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const avatarInitial = useMemo(() => {
    const trimmed = (displayName || "A").trim();
    return trimmed.charAt(0).toUpperCase() || "A";
  }, [displayName]);

  async function executeLogout() {
    // Use the absolute API base so cross-origin deployments hit the real
    // backend instead of 404ing on the frontend origin.
    const base = env.API_URL || "";
    try {
      await fetch(`${base}/api/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Best-effort; proceed to the login page even if the POST fails so
      // the user doesn't get stuck.
    }
    // Cross-user data-leak fix: wipe per-user persisted zustand stores
    // (watchlist, notifications, preferences, ui + auxiliary keys) and
    // their in-memory snapshots so user A's state doesn't paint between
    // logout and user B's hydrate. Runs unconditionally — even if the
    // /auth/logout POST above failed, we still wipe local state because
    // the user's intent to sign out should not leave their data behind
    // on a shared browser.
    clearPersistedStores();
    // Stop the in-memory refresh-token scheduler so it doesn't fire a
    // 401 storm after the backend revokes the session.
    window.dispatchEvent(new CustomEvent("alphadesk:auth-logout"));
    // HttpOnly cookies can't be cleared from JS — rely on the backend's
    // Set-Cookie: Max-Age=0 header in the /logout response.
    window.location.href = "/login";
  }

  function handleLogout() {
    destructive.request({
      title: "Sign out",
      description: "End the current session.",
      consequences: [
        "Unsaved order tickets and strategy drafts are lost.",
        "You'll need to sign in again to resume.",
      ],
      confirmLabel: "Sign out",
      onConfirm: executeLogout,
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger data-tour="profile-menu" className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-label font-bold text-primary hover:bg-primary/25 transition-colors sm:h-8 sm:w-8" aria-label="User menu">
          {avatarInitial}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" className="w-56 bg-[var(--bg-card)] border-border">
          <div className="px-3 py-2 space-y-1">
            <p className="text-label font-medium text-foreground truncate" title={displayName}>{displayName}</p>
            <div className="flex items-center justify-between text-label">
              <span className="text-muted-foreground">Equity</span>
              <span className="text-foreground tabular-nums">{formatCurrency(summary.equity > 0 ? summary.equity : 0)}</span>
            </div>
          </div>
          <DropdownMenuSeparator />
          <div className="px-3 py-1 text-label uppercase tracking-wider text-muted-foreground">Account</div>
          <DropdownMenuItem onClick={() => router.push("/settings")}><GearSix className="mr-2 h-3.5 w-3.5" />Settings</DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/reports")}><FileText className="mr-2 h-3.5 w-3.5" />Reports & tax</DropdownMenuItem>
          <DropdownMenuItem onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))}><Keyboard className="mr-2 h-3.5 w-3.5" />Keyboard shortcuts</DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="px-3 py-1 text-label uppercase tracking-wider text-muted-foreground">Administration</div>
          <DropdownMenuItem onClick={() => router.push("/admin/control-center")}><ShieldCheck className="mr-2 h-3.5 w-3.5" />Control center</DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/admin/users")}><UsersThree className="mr-2 h-3.5 w-3.5" />Users & access</DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="px-3 py-1.5">
            <p className="mb-1.5 text-label uppercase tracking-wider text-muted-foreground">Theme</p>
            <div
              role="radiogroup"
              aria-label="Theme preference"
              className="grid grid-cols-3 gap-1 rounded-sm border border-border bg-bg p-1"
            >
              {(["dark", "light", "system"] as const).map((opt: ThemePreference) => (
                <button
                  key={opt}
                  type="button"
                  role="radio"
                  aria-checked={theme === opt}
                  onClick={() => setDisplayPref("theme", opt)}
                  className={cn(
                    "min-h-8 rounded-xs px-2 text-label font-medium capitalize transition-colors",
                    theme === opt
                      ? "bg-primary/15 text-primary ring-1 ring-primary/25"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout}><SignOut className="mr-2 h-3.5 w-3.5" />Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {destructive.pending && (
        <DestructiveConfirmModal
          open={true}
          onOpenChange={(open) => !open && destructive.dismiss()}
          loading={destructive.loading}
          title={destructive.pending.title}
          description={destructive.pending.description}
          consequences={destructive.pending.consequences}
          confirmLabel={destructive.pending.confirmLabel}
          onConfirm={destructive.fire}
        />
      )}
    </>
  );
}
