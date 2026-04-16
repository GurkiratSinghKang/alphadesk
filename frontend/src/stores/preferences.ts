import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── Types ──────────────────────────────────────────────────

export interface NotificationPrefs {
  orderFills: boolean;
  alertsTriggered: boolean;
  pipelineCompleted: boolean;
  strategyEvents: boolean;
}

export interface DisplayPrefs {
  tickerTapeOn: boolean;
  compactStrategyView: boolean;
  animationSpeed: "normal" | "reduced" | "none";
}

export interface DataPrefs {
  refreshInterval: number; // seconds: 10, 30, 60, 120
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
  strategyEvents: false,
};

const defaultDisplay: DisplayPrefs = {
  tickerTapeOn: true,
  compactStrategyView: false,
  animationSpeed: "normal",
};

const defaultData: DataPrefs = {
  refreshInterval: 60,
};

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
        set((state) => ({
          data: { ...state.data, [key]: value },
        })),

      resetAll: () =>
        set({
          notifications: { ...defaultNotifications },
          display: { ...defaultDisplay },
          data: { ...defaultData },
        }),
    }),
    {
      name: "alphadesk-preferences",
      skipHydration: true,
    }
  )
);
