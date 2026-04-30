import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── Types ──────────────────────────────────────────────────

export interface NotificationPrefs {
  orderFills: boolean;
  alertsTriggered: boolean;
  pipelineCompleted: boolean;
  /**
   * @deprecated Persona-8 #4 — no producer ever called
   * `shouldNotify("strategyEvents")`. The Settings UI toggle is gone;
   * this field only persists as `false`. Kept on the type so the legacy
   * `prefKey` union in `hooks/useNotifications.ts:71` still satisfies
   * `keyof NotificationPrefs`. Drop both together in a follow-up wave
   * once `useNotifications.ts` can be edited.
   */
  strategyEvents: boolean;
}

export type ThemePreference = "system" | "dark" | "light";

export interface DisplayPrefs {
  /**
   * @deprecated The dashboard ticker tape was removed from the product
   * chrome. Kept in the persisted shape so older localStorage payloads
   * migrate without throwing, but no UI reads it anymore.
   */
  tickerTapeOn: boolean;
  compactStrategyView: boolean;
  /**
   * Colour scheme preference. ``"system"`` defers to the OS via the
   * ``prefers-color-scheme`` media query; ``"dark"`` / ``"light"`` force the
   * matching ``class="dark"`` / ``class="light"`` attribute on ``<html>``.
   * The token layer ships tuned dark and light palettes; ``system`` follows
   * the current OS preference.
   */
  theme: ThemePreference;
  // animationSpeed: REMOVED (persona-8 #2) — no consumer. Wiring a single
  // global speed knob across lightweight-charts, the marquee, the pulse
  // dots, etc. is a real project; the rest of the app honours
  // `prefers-reduced-motion` instead. The toggle was deceptive.
}

export interface DataPrefs {
  /**
   * Portfolio-refresh interval in **seconds**. Consumed by
   * `useDataPipeline` to schedule the periodic portfolio poll.
   * Clamped to the [10, 300] range in `setDataPref` so a slider miswire
   * cannot accidentally DDoS the API.
   */
  refreshInterval: number;
}

interface PreferencesState {
  notifications: NotificationPrefs;
  display: DisplayPrefs;
  data: DataPrefs;

  setNotificationPref: <K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => void;
  setDisplayPref: <K extends keyof DisplayPrefs>(key: K, value: DisplayPrefs[K]) => void;
  setDataPref: <K extends keyof DataPrefs>(key: K, value: DataPrefs[K]) => void;
  resetAll: () => void;
}

// ─── Defaults ───────────────────────────────────────────────

const defaultNotifications: NotificationPrefs = {
  orderFills: true,
  alertsTriggered: true,
  pipelineCompleted: true,
  // Always false; no UI exposes it, no producer reads it.
  strategyEvents: false,
};

const defaultDisplay: DisplayPrefs = {
  tickerTapeOn: false,
  compactStrategyView: false,
  // Default to "dark" to preserve the established desk look for existing
  // users; the header toggle and Settings page now expose light mode.
  theme: "dark",
};

const defaultData: DataPrefs = {
  refreshInterval: 30,
};

// Refresh-interval bounds in seconds. Lower than 10s starts to look like
// an accidental DDoS; higher than 5 minutes defeats the point.
export const REFRESH_INTERVAL_MIN = 10;
export const REFRESH_INTERVAL_MAX = 300;

function clampRefreshInterval(seconds: number): number {
  if (!Number.isFinite(seconds)) return defaultData.refreshInterval;
  return Math.min(REFRESH_INTERVAL_MAX, Math.max(REFRESH_INTERVAL_MIN, Math.round(seconds)));
}

// ─── Store ──────────────────────────────────────────────────

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      notifications: { ...defaultNotifications },
      display: { ...defaultDisplay },
      data: { ...defaultData },

      setNotificationPref: (key, value) =>
        set((state) => ({
          notifications: { ...state.notifications, [key]: value },
        })),

      setDisplayPref: (key, value) =>
        set((state) => ({
          display: { ...state.display, [key]: value },
        })),

      setDataPref: (key, value) =>
        set((state) => {
          let nextValue = value;
          if (key === "refreshInterval") {
            nextValue = clampRefreshInterval(value as number) as DataPrefs[typeof key];
          }
          return {
            data: { ...state.data, [key]: nextValue },
          };
        }),

      resetAll: () =>
        set({
          notifications: { ...defaultNotifications },
          display: { ...defaultDisplay },
          data: { ...defaultData },
        }),
    }),
    {
      name: "alphadesk-preferences",
      version: 1,
      // v0 had `display.animationSpeed` and `notifications.strategyEvents`
      // as persisted fields. `partialize` already drops anything outside
      // the current shape on the next write, but during the read of an
      // existing v0 blob those keys come back as extras on the nested
      // objects. They're harmless (no consumer), and the next `set` will
      // overwrite the slice cleanly. `migrate` is a no-op today; declared
      // so future shape changes have a hook to land in.
      migrate: (persistedState) => persistedState as PreferencesState,
      partialize: (state) => ({
        notifications: state.notifications,
        display: state.display,
        data: state.data,
      }),
      skipHydration: true,
    }
  )
);

// ─── Cross-tab sync (persona-8 #5) ──────────────────────────
//
// Without this, opening Settings in tab A and toggling "Order Fills" off
// leaves tab B firing fill toasts until reload. Listen for the localStorage
// "storage" event (fired in *other* tabs whenever this tab writes the same
// key) and replay the persisted state into our store.
//
// Mirrors the pattern Wave 31 is rolling out for `market`, `ui`, and
// `notifications` stores.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== "alphadesk-preferences") return;
    if (!e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue);
      if (parsed && typeof parsed === "object" && parsed.state) {
        usePreferencesStore.setState(parsed.state);
      }
    } catch {
      // Ignore malformed payloads — next legitimate write will recover.
    }
  });
}
