"use client";

import * as React from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import NotificationDrawer from "@/components/composites/NotificationDrawer";
import { useNotificationsStore } from "@/stores/notifications";
import { cn } from "@/lib/utils";

/**
 * NotificationBell
 * ─────────────────
 * v2 phase 1.7 — top-bar trigger that opens the new
 * Sheet-based NotificationDrawer (Phase 0b primitive). Replaces
 * the previous Popover-based NotificationCenter mount.
 *
 * Same store → identical data flow. The existing
 * `useNotifications()` producer hook in `(dashboard)/layout.tsx`
 * continues to write to `useNotificationsStore`; consumers (this
 * bell + the drawer) read from it.
 *
 * Per D5 (locked decision): existing NotificationCenter component
 * stays in the tree for one release as a fallback if any deep-link
 * still references the old popover trigger; this wrapper component
 * IS the v2 entry point in TopBar.
 */
export default function NotificationBell() {
  const [open, setOpen] = React.useState(false);
  const unread = useNotificationsStore(
    (s) => s.notifications.filter((n) => !n.read).length,
  );

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative h-11 w-11 sm:h-8 sm:w-8"
        aria-label={
          unread > 0
            ? `Notifications, ${unread} unread`
            : "Notifications"
        }
        onClick={() => setOpen(true)}
      >
        <Bell className="h-4 w-4 text-muted-foreground" />
        {unread > 0 && (
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-loss text-eyebrow font-bold text-down-on",
            )}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>
      <NotificationDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}
