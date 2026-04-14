"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Settings, Keyboard, LogOut, FileText } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui";
import { usePortfolioStore } from "@/stores/portfolio";
import { formatCurrency, cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

export function ProfileMenu() {
  const router = useRouter();
  const { tradingMode, setTradingMode } = useUIStore();
  const summary = usePortfolioStore((s) => s.summary);
  const { toast } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modeConfirmOpen, setModeConfirmOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setSettingsOpen(false);
    setModeConfirmOpen(false);
  }, [pathname]);

  const handleModeToggle = () => {
    if (tradingMode === "paper") setModeConfirmOpen(true);
    else setTradingMode("paper");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger data-tour="profile-menu" className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary hover:bg-primary/25 transition-colors" aria-label="User menu">
          A
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" className="w-56 bg-[var(--surface)] border-border">
          <div className="px-3 py-2 space-y-1">
            <p className="text-xs font-medium text-foreground">admin</p>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#8a8a95]">Equity</span>
              <span className="text-foreground tabular-nums">{formatCurrency(summary.equity > 0 ? summary.equity : 0)}</span>
            </div>
          </div>
          <DropdownMenuSeparator />
          <div className="px-3 py-1.5">
            <p className="text-[10px] uppercase tracking-wider text-[#8a8a95] mb-1.5">Trading Mode</p>
            <div className="flex gap-1.5">
              <button onClick={() => setTradingMode("paper")} className={cn("rounded px-2.5 py-1 text-[11px] font-medium transition-colors", tradingMode === "paper" ? "bg-[var(--profit)]/15 text-[var(--profit)] ring-1 ring-[var(--profit)]/30" : "bg-[var(--panel)] text-muted-foreground")}>Paper</button>
              <button onClick={handleModeToggle} className={cn("rounded px-2.5 py-1 text-[11px] font-medium transition-colors", tradingMode === "live" ? "bg-[var(--loss)]/15 text-[var(--loss)] ring-1 ring-[var(--loss)]/30" : "bg-[var(--panel)] text-muted-foreground")}>Live</button>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push("/reports")}><FileText className="mr-2 h-3.5 w-3.5" />Reports & Export</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSettingsOpen(true)}><Settings className="mr-2 h-3.5 w-3.5" />Settings</DropdownMenuItem>
          <DropdownMenuItem onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))}><Keyboard className="mr-2 h-3.5 w-3.5" />Keyboard Shortcuts</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={async () => { try { await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }); } catch {} document.cookie = "access_token=; path=/; max-age=0"; window.location.href = "/login"; }}><LogOut className="mr-2 h-3.5 w-3.5" />Logout</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="bg-[var(--surface)] border-border">
          <SheetHeader><SheetTitle>Settings</SheetTitle><SheetDescription>Configure your trading environment.</SheetDescription></SheetHeader>
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Settings className="h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-foreground">Settings coming soon</p>
            <p className="text-xs text-muted-foreground mt-1">Broker API keys, preferences, and configuration will be available here.</p>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={modeConfirmOpen} onOpenChange={setModeConfirmOpen}>
        <DialogContent className="bg-[var(--surface)] border-border">
          <DialogHeader><DialogTitle>Switch to Live Trading?</DialogTitle><DialogDescription>Real orders will be submitted to your broker.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModeConfirmOpen(false)} className="text-xs">Cancel</Button>
            <Button onClick={() => { setTradingMode("live"); setModeConfirmOpen(false); toast({ type: "warning", message: "Trading mode is configured server-side. Contact admin to switch between paper and live." }); }} className="bg-[var(--loss)] hover:bg-[var(--loss)]/90 text-white text-xs">Confirm Live Mode</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
