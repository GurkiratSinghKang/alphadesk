"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Zap, LayoutDashboard, BarChart3, Bot, Search, Bell, Menu, LineChart, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { ProfileMenu } from "./ProfileMenu";
import { NotificationCenter } from "./NotificationCenter";

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { setCommandPaletteOpen } = useUIStore();
  const [isMac, setIsMac] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    setIsMac(typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? ""));
  }, []);

  const isHome = pathname === "/";
  const isTrade = pathname === "/trade";
  const isPipeline = pathname === "/pipeline";
  const isAnalytics = pathname === "/analytics";
  const isAlerts = pathname === "/alerts";
  const isReports = pathname === "/reports";

  const navItems = [
    { path: "/", label: "Dashboard", icon: LayoutDashboard, active: isHome },
    { path: "/trade", label: "Trade", icon: BarChart3, active: isTrade },
    { path: "/analytics", label: "Analytics", icon: LineChart, active: isAnalytics },
    { path: "/alerts", label: "Alerts", icon: Bell, active: isAlerts },
    { path: "/pipeline", label: "Pipeline", icon: Bot, active: isPipeline },
    { path: "/reports", label: "Reports", icon: FileText, active: isReports },
  ];

  return (
    <header role="banner" className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-[var(--surface)] px-4">
      <div className="flex items-center gap-4">
        {/* Mobile hamburger menu */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger render={
            <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" aria-label="Open menu">
              <Menu className="h-4 w-4 text-muted-foreground" />
            </Button>
          } />
          <SheetContent side="left" className="w-64 bg-[var(--surface)] border-border p-0">
            <SheetHeader className="border-b border-border px-4 py-3">
              <SheetTitle className="flex items-center gap-2 text-sm">
                <Zap className="h-4 w-4 text-primary" />
                AlphaDesk
              </SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 p-3">
              {navItems.map(({ path, label, icon: Icon, active }) => (
                <button
                  key={path}
                  onClick={() => { router.push(path); setMobileMenuOpen(false); }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </nav>
          </SheetContent>
        </Sheet>

        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => router.push("/")}
        >
          <Zap className="h-5 w-5 text-primary" />
          <span className="text-base font-bold tracking-tight text-foreground">AlphaDesk</span>
        </div>
        {/* Desktop navigation -- hidden on mobile */}
        <nav aria-label="Main navigation" className="hidden md:flex items-center gap-1 ml-2">
          {navItems.map(({ path, label, icon: Icon, active }) => (
            <button key={path} onClick={() => router.push(path)} className={cn("flex items-center gap-1.5 rounded-md px-3 py-2 text-[11px] font-medium transition-colors", active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent/50")}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </nav>
      </div>

      <button onClick={() => setCommandPaletteOpen(true)} aria-label="Open command palette to search symbols and commands" className="flex h-8 flex-1 max-w-[480px] items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="flex-1 text-left">Search symbols, commands...</span>
        <kbd className="rounded bg-[var(--panel)] px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{isMac ? "\u2318K" : "Ctrl+K"}</kbd>
      </button>

      <div className="flex items-center gap-2">
        <NotificationCenter />
        <ProfileMenu />
      </div>
    </header>
  );
}
