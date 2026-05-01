import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── Types ──────────────────────────────────────────────────

export type NotificationCategory = "trades" | "alerts" | "pipeline" | "system";

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  detail: string;
  timestamp: number;
  read: boolean;
  icon?: string; // lucide icon name hint: "check", "alert-triangle", "bot", "shield", etc.
}

// ─── Store ──────────────────────────────────────────────────

interface NotificationsState {
  notifications: AppNotification[];
  addNotification: (n: Omit<AppNotification, "id" | "timestamp" | "read">) => void;
  markAsRead: (id: string) => void;
  markAllRead: () => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  unreadCount: () => number;
}

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set, get) => ({
      notifications: [],

      addNotification: (n) =>
        set((state) => {
          // BUG-033: the bell count drifted +1 between /alerts and
          // /pipeline because the same lifecycle event can arrive on
          // multiple channels (portfolio + trade_updates both fan fills)
          // and push twice. The first pass only checked the head item
          // inside a 2s window; a burst with one different notification
          // in between still flooded the bell. Collapse any identical
          // {category,title,detail} notification seen in the last 30s,
          // move it back to the top, and mark it unread so the user still
          // sees that the event reoccurred without getting 20 rows.
          const now = Date.now();
          const duplicateIdx = state.notifications.findIndex((existing) =>
            existing.category === n.category &&
            existing.title === n.title &&
            existing.detail === n.detail &&
            now - existing.timestamp < 30_000
          );
          if (duplicateIdx >= 0) {
            const duplicate = state.notifications[duplicateIdx];
            return {
              notifications: [
                { ...duplicate, timestamp: now, read: false },
                ...state.notifications.filter((_, i) => i !== duplicateIdx),
              ].slice(0, 50),
            };
          }
          return {
            notifications: [
              {
                ...n,
                id: `notif-${now}-${Math.random().toString(36).slice(2, 8)}`,
                timestamp: now,
                read: false,
              },
              ...state.notifications,
            ].slice(0, 50), // Round 7 Fix 3 (P128) — keep last 50.
            // Prior value 200 wrote a 200-item array to localStorage on
            // every single notification (zustand persist fires on every
            // set), which thrashed Safari's quota and made the bell feel
            // sluggish. 50 covers "session history" without the IO cost.
          };
        }),

      markAsRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          ),
        })),

      markAllRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
        })),

      removeNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),

      clearAll: () => set({ notifications: [] }),

      unreadCount: () => get().notifications.filter((n) => !n.read).length,
    }),
    {
      name: "alphadesk-notifications",
      // persona-9 #4 — declare version + migrate now so future schema
      // changes (e.g. dropping a category, renaming a field) don't
      // silently corrupt state on old clients.
      version: 1,
      migrate: (persistedState, version) => {
        if (version < 1) {
          return persistedState as NotificationsState;
        }
        return persistedState as NotificationsState;
      },
      // Round 7 Fix 3 (P128): persist only the newest 50 items. The
      // in-memory state is already capped at 50 by the slice() above,
      // but partialize gives us a belt-and-braces guarantee — an older
      // client that persisted a 200-item array can't spontaneously
      // rehydrate with more than 50, and the write cost stays bounded
      // even if a future code change loosens the in-memory cap.
      partialize: (state) => ({
        notifications: state.notifications.slice(0, 50),
      }),
      skipHydration: true,
    }
  )
);

// ─── Cross-tab read-state sync (persona-10 #1) ───────────────
//
// When tab A marks a notification as read (or clears one), tab B should
// reflect that — otherwise the unread badge stays stuck. We DO sync the
// full notifications list because the read flag lives inline on each
// item; trying to sync only "ids of read items" would require a richer
// schema. The list is capped at 50 in addNotification (Round 7 Fix 3),
// so the storage event payload is bounded.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== "alphadesk-notifications") return;
    if (!e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue) as {
        state?: { notifications?: AppNotification[] };
      };
      const incoming = parsed.state?.notifications;
      if (!Array.isArray(incoming)) return;
      // Cheap shallow check — same length AND same first-item id usually
      // means no change (read marks usually come in batches, ids stable).
      const current = useNotificationsStore.getState().notifications;
      if (
        current.length === incoming.length &&
        current.every((n, i) => n.id === incoming[i]?.id && n.read === incoming[i]?.read)
      ) {
        return;
      }
      useNotificationsStore.setState({ notifications: incoming });
    } catch {
      // malformed payload — ignore
    }
  });
}
