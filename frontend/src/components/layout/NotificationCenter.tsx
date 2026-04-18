"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Bot,
  Shield,
  LogIn,
  Clock,
  ShoppingCart,
  XCircle,
  CheckCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotificationsStore, type NotificationCategory, type AppNotification } from "@/stores/notifications";
import { cn } from "@/lib/utils";

// ─── Tab filter types ───────────────────────────────────────

type TabFilter = "all" | NotificationCategory;

const TABS: { value: TabFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "trades", label: "Trades" },
  { value: "alerts", label: "Alerts" },
  { value: "pipeline", label: "Pipeline" },
  { value: "system", label: "System" },
];

// ─── Icon resolver ──────────────────────────────────────────

function NotificationIcon({ category, iconHint }: { category: NotificationCategory; iconHint?: string }) {
  const cls = "h-3.5 w-3.5";
  if (iconHint === "check" || iconHint === "filled") return <CheckCircle2 className={cn(cls, "text-[var(--profit)]")} />;
  if (iconHint === "rejected" || iconHint === "alert-triangle") return <AlertTriangle className={cn(cls, "text-[var(--loss)]")} />;
  if (iconHint === "bot") return <Bot className={cn(cls, "text-[var(--chart-5)]")} />;
  if (iconHint === "shield") return <Shield className={cn(cls, "text-amber-400")} />;
  if (iconHint === "login") return <LogIn className={cn(cls, "text-[var(--chart-4)]")} />;
  if (iconHint === "clock") return <Clock className={cn(cls, "text-muted-foreground")} />;

  switch (category) {
    case "trades": return <ShoppingCart className={cn(cls, "text-[var(--profit)]")} />;
    case "alerts": return <AlertTriangle className={cn(cls, "text-[var(--chart-4)]")} />;
    case "pipeline": return <Bot className={cn(cls, "text-[var(--chart-5)]")} />;
    case "system": return <Shield className={cn(cls, "text-muted-foreground")} />;
    default: return <Bell className={cn(cls, "text-muted-foreground")} />;
  }
}

// ─── Relative time ──────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Single notification row ────────────────────────────────

function NotificationRow({ notification, onRead }: { notification: AppNotification; onRead: (id: string) => void }) {
  return (
    <button
      onClick={() => onRead(notification.id)}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md px-3 py-2.5 text-left text-xs transition-colors hover:bg-accent/50",
        !notification.read && "bg-primary/5"
      )}
    >
      <div className="mt-0.5 shrink-0">
        <NotificationIcon category={notification.category} iconHint={notification.icon} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("text-foreground leading-tight font-medium", notification.read && "font-normal opacity-60")}>
            {notification.title}
          </p>
          {!notification.read && (
            <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          )}
        </div>
        <p className="mt-0.5 text-muted-foreground leading-snug">{notification.detail}</p>
        <span className="mt-1 block text-[10px] text-muted-foreground">{relativeTime(notification.timestamp)}</span>
      </div>
    </button>
  );
}

// ─── Notification Center ────────────────────────────────────

export function NotificationCenter() {
  const notifications = useNotificationsStore((s) => s.notifications);
  const markAsRead = useNotificationsStore((s) => s.markAsRead);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const clearAll = useNotificationsStore((s) => s.clearAll);
  const [activeTab, setActiveTab] = useState<TabFilter>("all");

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const filtered = useMemo(
    () =>
      activeTab === "all"
        ? notifications
        : notifications.filter((n) => n.category === activeTab),
    [notifications, activeTab]
  );

  // Notifications are produced by the `useNotifications` hook mounted in
  // the dashboard layout. It subscribes to the websocket (portfolio + alerts
  // channels) and the global `alphadesk:pipeline-status` /
  // `alphadesk:system-notify` custom events, gates each push on the user's
  // preferences (Settings → Notifications), and calls `addNotification`.

  return (
    <Popover>
      <PopoverTrigger>
        <Button variant="ghost" size="icon" className="relative h-8 w-8" aria-label="Notifications">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" sideOffset={4} className="w-[calc(100vw-2rem)] max-w-96 sm:w-96 bg-[var(--surface)] border-border p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-xs font-semibold text-foreground">Notifications</span>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                title="Mark all as read"
              >
                <CheckCheck className="h-3 w-3" />
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                title="Clear all"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 border-b border-border px-2 py-1.5">
          {TABS.map((tab) => {
            const count =
              tab.value === "all"
                ? notifications.filter((n) => !n.read).length
                : notifications.filter((n) => n.category === tab.value && !n.read).length;
            return (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors",
                  activeTab === tab.value
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                {tab.label}
                {count > 0 && (
                  <span className="ml-1 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-primary/20 px-1 text-[8px] font-bold text-primary">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Notification list */}
        <ScrollArea className="max-h-96">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <Bell className="h-6 w-6 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">
                {activeTab === "all" ? "No notifications yet" : `No ${activeTab} notifications`}
              </p>
            </div>
          ) : (
            <div className="py-1">
              {filtered.slice(0, 50).map((n) => (
                <NotificationRow key={n.id} notification={n} onRead={markAsRead} />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        {filtered.length > 0 && (
          <div className="border-t border-border px-3 py-2 text-center">
            <span className="text-[10px] text-muted-foreground">
              {filtered.length} notification{filtered.length !== 1 ? "s" : ""}
              {unreadCount > 0 && ` · ${unreadCount} unread`}
            </span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
