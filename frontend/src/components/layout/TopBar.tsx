"use client";

import { usePathname, useRouter } from "next/navigation";
import { Zap, LayoutDashboard, BarChart3, Bot, Search, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUIStore } from "@/stores/ui";
import { useAlertsStore } from "@/stores/alerts";
import { formatTimestamp, cn } from "@/lib/utils";
import { ProfileMenu } from "./ProfileMenu";

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { setCommandPaletteOpen } = useUIStore();
  const alerts = useAlertsStore((s) => s.alerts);
  const unacknowledgedCount = useAlertsStore((s) => s.alerts.filter((a) => !a.acknowledged).length);
  const acknowledgeAlert = useAlertsStore((s) => s.acknowledgeAlert);

  const isHome = pathname === "/";
  const isTrade = pathname === "/trade";
  const isPipeline = pathname === "/pipeline";

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-[var(--surface)] px-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          <span className="text-base font-bold tracking-tight text-foreground">AlphaDesk</span>
        </div>
        <nav className="flex items-center gap-1 ml-2">
          {[
            { path: "/", label: "Dashboard", icon: LayoutDashboard, active: isHome },
            { path: "/trade", label: "Trade", icon: BarChart3, active: isTrade },
            { path: "/pipeline", label: "Pipeline", icon: Bot, active: isPipeline },
          ].map(({ path, label, icon: Icon, active }) => (
            <button key={path} onClick={() => router.push(path)} className={cn("flex items-center gap-1.5 rounded-md px-3 py-2 text-[11px] font-medium transition-colors", active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent/50")}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </nav>
      </div>

      <button onClick={() => setCommandPaletteOpen(true)} className="flex h-8 w-[480px] items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search symbols, commands...</span>
        <kbd className="rounded bg-[var(--panel)] px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">Ctrl+K</kbd>
      </button>

      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative h-8 w-8"><Bell className="h-4 w-4 text-muted-foreground" />{unacknowledgedCount > 0 && (<span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">{unacknowledgedCount > 9 ? "9+" : unacknowledgedCount}</span>)}</Button>} />
          <PopoverContent side="bottom" align="end" className="w-80 bg-[var(--surface)] border-border p-0">
            <div className="border-b border-border px-3 py-2"><span className="text-xs font-medium text-foreground">Alerts & Notifications</span></div>
            <ScrollArea className="max-h-64">
              {alerts.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">No alerts yet</div>
              ) : (
                <div className="py-1">
                  {alerts.slice(0, 20).map((alert) => (
                    <button key={alert.id} onClick={() => acknowledgeAlert(alert.id)} className={cn("flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50", alert.acknowledged && "opacity-50")}>
                      <span className={cn("mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full", alert.type === "price" ? "bg-primary" : alert.type === "order" ? "bg-[var(--profit)]" : alert.type === "signal" ? "bg-[var(--chart-4)]" : "bg-muted-foreground")} />
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground leading-tight">{alert.message}</p>
                        <span className="text-[10px] text-muted-foreground">{formatTimestamp(alert.time)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </PopoverContent>
        </Popover>
        <ProfileMenu />
      </div>
    </header>
  );
}
