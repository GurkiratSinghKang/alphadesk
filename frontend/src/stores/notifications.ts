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
          // and push twice. De-dupe against the most recent notification
          // on a {category, title, detail} tuple within a 2s window —
          // short enough that a legitimate re-trigger (user manually
          // replaying a fill) still lands, long enough to absorb the
          // multi-channel race that causes the drift.
          const head = state.notifications[0];
          if (
            head &&
            head.category === n.category &&
            head.title === n.title &&
            head.detail === n.detail &&
            Date.now() - head.timestamp < 2_000
          ) {
            return {} as Partial<NotificationsState>;
          }
          return {
            notifications: [
              {
                ...n,
                id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                timestamp: Date.now(),
                read: false,
              },
              ...state.notifications,
            ].slice(0, 200), // keep last 200
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
      // Persist the full notifications array — read flag and dedup id
      // both need to survive a reload; partializing them away would
      // cause unread badges to ressurect on every refresh.
      partialize: (state) => ({ notifications: state.notifications }),
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
// schema. The list is capped at 200 in addNotification, so the storage
// event payload is bounded.
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
