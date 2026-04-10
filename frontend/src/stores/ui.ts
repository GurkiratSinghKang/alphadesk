import { create } from "zustand";

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

export const useUIStore = create<UIState>((set) => ({
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
}));
