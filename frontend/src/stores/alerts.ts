import { create } from "zustand";
import type { Alert } from "@/types";

interface AlertsState {
  alerts: Alert[];
  addAlert: (alert: Alert) => void;
  acknowledgeAlert: (id: string) => void;
  clearAlerts: () => void;
}

export const useAlertsStore = create<AlertsState>((set) => ({
  alerts: [],

  addAlert: (alert) =>
    set((state) => ({ alerts: [alert, ...state.alerts].slice(0, 100) })),

  acknowledgeAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.map((a) =>
        a.id === id ? { ...a, acknowledged: true } : a
      ),
    })),

  clearAlerts: () => set({ alerts: [] }),
}));
