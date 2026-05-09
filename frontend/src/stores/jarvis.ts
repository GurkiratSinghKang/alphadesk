import { create } from "zustand";

/**
 * Jarvis store
 * ─────────────
 * v2 redesign — UI state for the ⌘⇧J conversational command bar.
 * Phase 0 ships the *shell* (open / close / query) only; the
 * fuzzy-search through MOCK_CONTROLS happens at the component level
 * by composing useControls({query}). Phase 2 (B.7 backend) replaces
 * that fuzzy search with Anthropic-backed intent parsing + dry-run
 * + typed-confirm.
 *
 * Per the plan §0.7, only ONE Jarvis can be open at a time. The
 * keyboard shortcut wires `Ctrl+Shift+J` → `setOpen(true)`.
 */
interface JarvisState {
  open: boolean;
  query: string;
  setOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  /** Convenience — open with optional pre-populated prompt. */
  openWith: (query?: string) => void;
  /** Reset query and close (used by Esc + onConfirm). */
  reset: () => void;
}

export const useJarvisStore = create<JarvisState>((set) => ({
  open: false,
  query: "",
  setOpen: (open) => set({ open }),
  setQuery: (query) => set({ query }),
  openWith: (query) => set({ open: true, query: query ?? "" }),
  reset: () => set({ open: false, query: "" }),
}));
