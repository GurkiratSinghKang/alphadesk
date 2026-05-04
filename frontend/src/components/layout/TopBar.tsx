"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, BarChart3, Bot, Search, Bell, Menu, LineChart, FileText, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { ProfileMenu } from "./ProfileMenu";
import { NotificationCenter } from "./NotificationCenter";
import { ThemeToggle } from "./ThemeToggle";
import StatusPills from "./StatusPills";
// Round-11 / W-1 (P0): WorkspaceSelector was a placebo — selecting
// "Morning Research" persisted to localStorage, dispatched
// ``alphadesk:workspace-change`` into the void (zero subscribers
// in the dashboard tree), and toasted a lie about "7 sections
// emphasised". Round-9 reflow committed to the single-hero-per-page
// model and made the workspace concept obsolete. Selector unmounted;
// the file stays in the tree for now in case the concept revives,
// but the import is gone so it can't be accidentally re-added without
// a deliberate change.

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { setCommandPaletteOpen } = useUIStore();
  const [isMac, setIsMac] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
      setIsMac(/Mac|iPhone|iPad/.test(nav.userAgentData?.platform ?? nav.platform ?? ""));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const isHome = pathname === "/";
  const isTrade = pathname === "/trade";
  const isPipeline = pathname === "/pipeline";
  const isAnalytics = pathname === "/analytics";
  const isAlerts = pathname === "/alerts";
  const isReports = pathname === "/reports";
  // Wave 29 persona-1: mobile users were losing access to /strategies once
  // they left the desk — the non-desk TopBar had no Strategies entry so
  // there was no route back to the listing (Wave 27 is adding it). Add
  // between Dashboard and Analytics so the sidebar/sheet mirrors it.
  const isStrategies = pathname?.startsWith("/strategies") ?? false;

  const navItems = [
    { path: "/", label: "Dashboard", icon: LayoutDashboard, active: isHome },
    { path: "/strategies", label: "Strategies", icon: Target, active: isStrategies },
    { path: "/trade", label: "Trade", icon: BarChart3, active: isTrade },
    { path: "/analytics", label: "Analytics", icon: LineChart, active: isAnalytics },
    { path: "/alerts", label: "Alerts", icon: Bell, active: isAlerts },
    { path: "/pipeline", label: "Pipeline", icon: Bot, active: isPipeline },
    { path: "/reports", label: "Reports", icon: FileText, active: isReports },
  ];

  return (
    <header
      role="banner"
      data-slot="app-top-bar"
      className="relative z-20 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-ink-050/94 px-2 shadow-[0_12px_44px_-36px_rgba(0,0,0,0.9)] sm:px-4"
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-4">
        {/* Mobile hamburger menu */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger render={
            <Button
              variant="ghost"
              size="icon"
              className="min-h-touch min-w-touch md:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4 text-muted-foreground" />
            </Button>
          } />
          <SheetContent side="left" className="w-64 bg-[var(--surface)] border-border p-0">
            <SheetHeader className="border-b border-border px-4 py-3">
              <SheetTitle className="flex items-baseline gap-1.5 text-numeric-lg">
                <span className="font-display italic text-brand">α</span>
                <span>AlphaDesk</span>
              </SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 p-3">
              {navItems.map(({ path, label, icon: Icon, active }) => (
                <button
                  key={path}
                  onClick={() => { router.push(path); setMobileMenuOpen(false); }}
                  className={cn(
                    "flex min-h-11 items-center gap-2.5 rounded-sm border px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "border-brand/30 bg-brand/15 text-brand"
                      : "border-transparent text-muted-foreground hover:border-border-hair hover:bg-bg-elev-1 hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </nav>
          </SheetContent>
        </Sheet>

        <button
          type="button"
          aria-label="AlphaDesk home"
          className="inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-md px-1 font-display italic text-numeric-lg text-ink-1000 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
          onClick={() => router.push("/")}
        >
          <span className="text-brand">α</span>
          <span className="truncate">AlphaDesk</span>
        </button>
        {/* Desktop navigation -- hidden on mobile */}
        <nav aria-label="Main navigation" className="ml-2 hidden items-center gap-1 md:flex">
          {navItems.map(({ path, label, icon: Icon, active }) => (
            <button
              key={path}
              onClick={() => router.push(path)}
              className={cn(
                "flex min-h-9 items-center gap-1.5 rounded-sm border px-3 py-2 text-label font-medium transition-colors",
                active
                  ? "border-brand/30 bg-brand/15 text-brand"
                  : "border-transparent text-muted-foreground hover:border-border-hair hover:bg-bg-elev-1 hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </nav>
        {/* Round-11 / W-1: workspace selector removed (was a placebo). */}
      </div>

      <button data-tour="search-bar" onClick={() => setCommandPaletteOpen(true)} aria-label="Open command palette to search symbols and commands" className="hidden h-9 min-w-[180px] max-w-[520px] flex-1 items-center gap-2 rounded-sm border border-border-hair bg-bg-elev-1/80 px-3 text-sm text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors hover:border-brand/40 hover:text-foreground md:flex">
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="flex-1 text-left">Search symbols, commands...</span>
        <kbd className="rounded-sm border border-border-hair bg-bg px-2 py-0.5 text-label font-mono text-muted-foreground">{isMac ? "\u2318K" : "Ctrl+K"}</kbd>
      </button>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <StatusPills />
        <ThemeToggle className="h-11 w-11 sm:h-8 sm:w-8" />
        <NotificationCenter />
        <ProfileMenu />
      </div>
    </header>
  );
}
