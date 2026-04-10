import { create } from "zustand";

export interface SelectedStrike {
  strike: number;
  type: "call" | "put";
  expiry: string;
  price: number;
  delta: number;
}

interface OptionsState {
  selectedStrikes: SelectedStrike[];
  addStrike: (strike: SelectedStrike) => void;
  removeStrike: (strike: number, type: "call" | "put") => void;
  toggleStrike: (strike: SelectedStrike) => void;
  clearStrikes: () => void;
}

export const useOptionsStore = create<OptionsState>((set) => ({
  selectedStrikes: [],

  addStrike: (strike) =>
    set((state) => ({ selectedStrikes: [...state.selectedStrikes, strike] })),

  removeStrike: (strikeVal, type) =>
    set((state) => ({
      selectedStrikes: state.selectedStrikes.filter(
        (s) => !(s.strike === strikeVal && s.type === type)
      ),
    })),

  toggleStrike: (strike) =>
    set((state) => {
      const exists = state.selectedStrikes.some(
        (s) => s.strike === strike.strike && s.type === strike.type
      );
      if (exists) {
        return {
          selectedStrikes: state.selectedStrikes.filter(
            (s) => !(s.strike === strike.strike && s.type === strike.type)
          ),
        };
      }
      return { selectedStrikes: [...state.selectedStrikes, strike] };
    }),

  clearStrikes: () => set({ selectedStrikes: [] }),
}));
