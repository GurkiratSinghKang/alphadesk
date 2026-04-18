/**
 * notificationPrefs.ts
 * ────────────────────
 * Thin consumer-side helper for the notification preferences persisted
 * by `@/stores/preferences`. The store is the source of truth for
 * user toggles (Settings → Notifications). Producers (see
 * `@/hooks/useNotifications`) read the latest value via `getPrefs()`
 * rather than hooking into React state, so the gate is synchronous and
 * does not re-render consumers on toggle changes.
 */

import { usePreferencesStore, type NotificationPrefs } from "@/stores/preferences";

export type NotificationKind = keyof NotificationPrefs;

/** Snapshot current user preferences — safe to call outside React. */
export function getNotificationPrefs(): NotificationPrefs {
  return usePreferencesStore.getState().notifications;
}

/** Should we surface a notification of this kind right now? */
export function shouldNotify(kind: NotificationKind): boolean {
  return getNotificationPrefs()[kind];
}
