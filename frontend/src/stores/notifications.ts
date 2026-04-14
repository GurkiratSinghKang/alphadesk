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
        set((state) => ({
          notifications: [
            {
              ...n,
              id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              timestamp: Date.now(),
              read: false,
            },
            ...state.notifications,
          ].slice(0, 200), // keep last 200
        })),

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
    }
  )
);
