import { create } from "zustand";
import { persist } from "zustand/middleware";

type PanelTab = string;

interface PanelConfig {
  left: PanelTab;
  center: PanelTab;
  right: PanelTab;
  bottom: PanelTab;
}

interface UIState {
  activePanels: PanelConfig;
  commandPaletteOpen: boolean;
  sidebarCollapsed: boolean;
  theme: "dark" | "light";
  tradingMode: "paper" | "live";

  setActiveTab: (panel: keyof PanelConfig, tab: PanelTab) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (theme: "dark" | "light") => void;
  setTradingMode: (mode: "paper" | "live") => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activePanels: {
        left: "watchlist",
        center: "chart",
        right: "technical",
        bottom: "trade",
      },
      commandPaletteOpen: false,
      sidebarCollapsed: false,
      theme: "dark",
      tradingMode: "paper",

      setActiveTab: (panel, tab) =>
        set((state) => ({
          activePanels: { ...state.activePanels, [panel]: tab },
        })),

      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      toggleCommandPalette: () =>
        set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setTheme: (theme) => set({ theme }),
      setTradingMode: (mode) => set({ tradingMode: mode }),
    }),
    {
      name: "alphadesk-ui",
      // persona-9 #4 — version + migrate so future schema changes
      // (e.g. theme migration, panel layout shape changes) land behind
      // a controlled migration rather than silent state corruption.
      version: 1,
      migrate: (persistedState, version) => {
        if (version < 1) {
          // No-op — earlier persisted blobs only had `tradingMode`,
          // which the new shape still accepts unchanged.
          return persistedState as UIState;
        }
        return persistedState as UIState;
      },
      partialize: (state) => ({ tradingMode: state.tradingMode }),
      skipHydration: true,
    }
  )
);

// ─── Cross-tab sync for tradingMode (persona-10 #1) ──────────
//
// tradingMode (paper vs live) MUST be consistent across tabs — otherwise
// a user could place a "paper" order from tab A while tab B believes
// it's live, leading to confusion or worse. We mirror the persisted
// tradingMode across tabs via the `storage` event.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== "alphadesk-ui") return;
    if (!e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue) as {
        state?: Partial<UIState>;
      };
      const incoming = parsed.state?.tradingMode;
      if (incoming !== "paper" && incoming !== "live") return;
      const current = useUIStore.getState().tradingMode;
      if (incoming !== current) {
        useUIStore.setState({ tradingMode: incoming });
      }
    } catch {
      // ignore malformed payloads
    }
  });
}
