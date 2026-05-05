"use client";

import { useState, useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Settings, Keyboard, LogOut, FileText } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import DestructiveConfirmModal from "@/components/destructive/DestructiveConfirmModal";
import { useDestructiveAction } from "@/components/destructive/useDestructiveAction";
import { useUIStore } from "@/stores/ui";
import { usePreferencesStore, type ThemePreference } from "@/stores/preferences";
import { usePortfolioStore } from "@/stores/portfolio";
import { formatCurrency, cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { env } from "@/env";

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
  const { tradingMode, setTradingMode } = useUIStore();
  const theme = usePreferencesStore((s) => s.display.theme);
  const setDisplayPref = usePreferencesStore((s) => s.setDisplayPref);
  const summary = usePortfolioStore((s) => s.summary);
  const { toast } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modeConfirmOpen, setModeConfirmOpen] = useState(false);
  const destructive = useDestructiveAction();
  const pathname = usePathname();

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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettingsOpen(false);
      setModeConfirmOpen(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  // Wave 29 persona-1 #7: clicking Live used to flip local Zustand state
  // and toast "contact admin" — the audit called this "misleading at best".
  // There's no /auth/switch-mode endpoint, so Live click now opens an
  // honest education dialog (option C) and never flips state. Paper click
  // is always safe (returning to sim).
  const handleLiveClick = () => {
    setModeConfirmOpen(true);
  };

  const handlePaperClick = () => {
    setTradingMode("paper");
  };

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

  // Wave 29 persona-1 #7 (option C) / chrome-batch-D P1-09: the dialog
  // is the live-mode confirmation flow, so the button reads "Confirm
  // and continue". It closes the dialog without flipping state — no
  // /auth/switch-mode endpoint exists, so we never pretend to have
  // switched. The toast reinforces the admin ask.
  async function handleConfirmLive() {
    setModeConfirmOpen(false);
    toast({
      type: "info",
      message: "Contact admin to enable live trading on your account.",
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
          <div className="px-3 py-1.5">
            <p className="text-label uppercase tracking-wider text-muted-foreground mb-1.5">Trading Mode</p>
            <div role="radiogroup" aria-label="Trading mode" className="flex gap-1.5">
              <button role="radio" aria-checked={tradingMode === "paper"} onClick={handlePaperClick} className={cn("rounded px-2.5 py-1 text-label font-medium transition-colors", tradingMode === "paper" ? "bg-[var(--profit)]/15 text-[var(--profit)] ring-1 ring-[var(--profit)]/30" : "bg-[var(--panel)] text-muted-foreground")}>Paper</button>
              <button role="radio" aria-checked={tradingMode === "live"} onClick={handleLiveClick} className={cn("rounded px-2.5 py-1 text-label font-medium transition-colors", tradingMode === "live" ? "bg-[var(--loss)]/15 text-[var(--loss)] ring-1 ring-[var(--loss)]/30" : "bg-[var(--panel)] text-muted-foreground")}>Live</button>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push("/reports")}><FileText className="mr-2 h-3.5 w-3.5" />Reports & Export</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSettingsOpen(true)}><Settings className="mr-2 h-3.5 w-3.5" />Settings</DropdownMenuItem>
          <DropdownMenuItem onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))}><Keyboard className="mr-2 h-3.5 w-3.5" />Keyboard Shortcuts</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout}><LogOut className="mr-2 h-3.5 w-3.5" />Logout</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="bg-[var(--bg-card)] border-border">
          <SheetHeader><SheetTitle>Settings</SheetTitle><SheetDescription>Configure your trading environment.</SheetDescription></SheetHeader>
          <div className="space-y-6 px-4 py-6">
            {/* Theme section */}
            <div className="space-y-2">
              <h3 className="text-eyebrow font-bold uppercase tracking-wider text-foreground">Appearance</h3>
              <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
                <div
                  role="radiogroup"
                  aria-label="Theme preference"
                  className="grid grid-cols-3 gap-1 rounded-md border border-border bg-bg p-1"
                >
                  {(["dark", "light", "system"] as const).map((opt: ThemePreference) => (
                    <button
                      key={opt}
                      type="button"
                      role="radio"
                      aria-checked={theme === opt}
                      onClick={() => setDisplayPref("theme", opt)}
                      className={cn(
                        "min-h-9 rounded-sm px-2 text-label font-medium capitalize transition-colors",
                        theme === opt
                          ? "bg-primary/15 text-primary ring-1 ring-primary/25"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-label leading-snug text-muted-foreground">
                  Light mode uses the tuned porcelain palette; System follows your OS.
                </p>
              </div>
            </div>
            {/* Other settings placeholder */}
            <div className="space-y-2">
              <h3 className="text-eyebrow font-bold uppercase tracking-wider text-foreground">Configuration</h3>
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Settings className="h-6 w-6 text-muted-foreground/40 mb-2" />
                <p className="text-label text-muted-foreground">Broker API keys and additional preferences are configured in the full Settings page.</p>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={modeConfirmOpen} onOpenChange={setModeConfirmOpen}>
        <DialogContent className="bg-[var(--bg-card)] border-border">
          <DialogHeader>
            <DialogTitle>Live trading requires admin enablement</DialogTitle>
            <DialogDescription>
              Live trading requires broker API keys configured on the server.
              Contact your admin to provision credentials — this toggle
              cannot enable live trading on its own.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={handleConfirmLive} className="text-label">Confirm and continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
