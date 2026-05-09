"use client";

import * as React from "react";
import { Bell, Check, X } from "@phosphor-icons/react";

import StatusDot, { type StatusDotTone } from "@/components/primitives/StatusDot";
import EmptyState from "@/components/primitives/EmptyState";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  type AppNotification,
  type NotificationCategory,
  useNotificationsStore,
} from "@/stores/notifications";
import { cn } from "@/lib/utils";

/**
 * NotificationDrawer
 * ───────────────────
 * v2 redesign — slide-over notification inbox per v2-plan §1.7.
 * Replaces the previous Popover-based NotificationCenter with a
 * Sheet-based drawer that slides in from the right.
 *
 * Filter chips cover both v1 categories (trades / alerts / pipeline /
 * system) and v2 additions (fill / agent / risk / billing / support).
 * "All" shows everything; "Unread" filters to unread regardless of
 * category. Mark-all-read clears unread state for the visible
 * (filtered) set so a "Mark all read" within "Risk" doesn't
 * accidentally clear billing notifications the user hasn't seen.
 *
 * Empty state uses the v2 EmptyState with a "QUIET" eyebrow.
 *
 * The trigger button (bell with badge) lives in TopBar — this is
 * just the panel. Use `<NotificationDrawer open onOpenChange />`
 * controlled by parent state.
 */
export interface NotificationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional override list — primarily for `/_design` previews and
   * tests. Production uses `useNotificationsStore` directly.
   */
  notifications?: AppNotification[];
}

type FilterValue = "all" | "unread" | NotificationCategory;

const FILTER_CHIPS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "fill", label: "Fills" },
  { value: "agent", label: "Agents" },
  { value: "risk", label: "Risk" },
  { value: "system", label: "System" },
  { value: "billing", label: "Billing" },
  { value: "support", label: "Support" },
];

const categoryToneMap: Record<NotificationCategory, StatusDotTone> = {
  trades: "profit",
  fill: "profit",
  alerts: "amber",
  pipeline: "ice",
  system: "ice",
  agent: "brand",
  risk: "loss",
  billing: "amber",
  support: "ice",
};

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return "just now";
  const min = Math.round(diffMs / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

export default function NotificationDrawer({
  open,
  onOpenChange,
  notifications: notificationsOverride,
}: NotificationDrawerProps) {
  const storeNotifications = useNotificationsStore((s) => s.notifications);
  const markAsRead = useNotificationsStore((s) => s.markAsRead);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const removeNotification = useNotificationsStore((s) => s.removeNotification);

  const notifications = notificationsOverride ?? storeNotifications;
  const [filter, setFilter] = React.useState<FilterValue>("all");

  const filtered = React.useMemo(() => {
    if (filter === "all") return notifications;
    if (filter === "unread") return notifications.filter((n) => !n.read);
    return notifications.filter((n) => n.category === filter);
  }, [filter, notifications]);

  const unreadCount = React.useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const handleRowClick = React.useCallback(
    (n: AppNotification) => {
      if (!n.read) markAsRead(n.id);
    },
    [markAsRead],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[420px] sm:max-w-none border-l border-border bg-bg-card p-0 flex flex-col gap-0"
      >
        <SheetHeader className="px-4 py-3 border-b border-border-hair">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="font-display italic text-h2 text-fg flex items-center gap-2">
              <Bell className="h-4 w-4 text-brand" />
              Inbox
              {unreadCount > 0 && (
                <span className="t-label text-loss">· {unreadCount} unread</span>
              )}
            </SheetTitle>
            <button
              type="button"
              onClick={markAllRead}
              disabled={unreadCount === 0}
              className="text-body-sm text-fg-muted hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm px-1"
            >
              Mark all read
            </button>
          </div>
        </SheetHeader>

        <div
          role="tablist"
          aria-label="Filter notifications"
          className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-border-hair"
        >
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.value}
              role="tab"
              aria-selected={filter === chip.value}
              onClick={() => setFilter(chip.value)}
              className={cn(
                "px-2.5 py-1 rounded-pill text-eyebrow font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                filter === chip.value
                  ? "bg-brand text-brand-on"
                  : "bg-bg-elev-1 text-fg-muted hover:text-fg",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <ul
          role="list"
          className="flex-1 overflow-y-auto flex flex-col gap-0 divide-y divide-border-hair"
        >
          {filtered.length === 0 ? (
            <li className="p-6">
              <EmptyState
                eyebrow="QUIET"
                title="Inbox is quiet."
                description={
                  filter === "all"
                    ? "When fills, agent runs, or risk gates fire, they appear here."
                    : `No ${filter} notifications right now.`
                }
              />
            </li>
          ) : (
            filtered.map((n) => (
              <li key={n.id} className="contents">
                <article
                  className={cn(
                    "group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-bg-elev-1",
                    !n.read && "bg-bg-elev-1/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleRowClick(n)}
                    className="flex items-start gap-3 flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm"
                  >
                    <div className="shrink-0 mt-1">
                      <StatusDot tone={categoryToneMap[n.category]} size={7} />
                    </div>
                    <div className="min-w-0 flex flex-col gap-0.5">
                      <h3 className="text-body font-medium text-fg leading-snug truncate">
                        {n.title}
                      </h3>
                      <p className="text-body-sm text-fg-muted leading-snug line-clamp-2">
                        {n.detail}
                      </p>
                      <span className="text-eyebrow uppercase tracking-[0.08em] text-fg-hint mt-0.5">
                        {n.category} · {relativeTime(n.timestamp)}
                      </span>
                    </div>
                  </button>
                  <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                    {!n.read && (
                      <button
                        type="button"
                        onClick={() => markAsRead(n.id)}
                        aria-label="Mark read"
                        className="text-fg-muted hover:text-fg p-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeNotification(n.id)}
                      aria-label="Dismiss"
                      className="text-fg-muted hover:text-loss p-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </article>
              </li>
            ))
          )}
        </ul>

        <footer className="border-t border-border-hair px-4 py-2.5 flex items-center justify-between text-body-sm">
          <a
            href="/settings#alerts"
            className="text-fg-muted hover:text-fg underline-offset-2 hover:underline"
          >
            Manage alerts →
          </a>
          <span className="text-fg-hint">{notifications.length} total</span>
        </footer>
      </SheetContent>
    </Sheet>
  );
}
