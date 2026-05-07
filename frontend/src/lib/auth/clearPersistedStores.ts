/**
 * Clear all per-user persisted state from the browser on sign-out.
 *
 * Called from ProfileMenu.executeLogout(), the cross-tab logout handler in
 * api.ts, and the 401-redirect path. Removes localStorage keys for the 4
 * zustand-persisted stores (plus auxiliary per-user keys), then resets the
 * in-memory zustand state so the same-tab post-logout paint isn't stale.
 *
 * Without this, after user A logs out and user B logs in on a shared
 * browser, user A's watchlist / unread alert messages / preferences leak
 * before WatchlistHydrator (gated on auth) replaces them. Worse, an
 * unauth'd visit in between would also paint user A's persisted blob,
 * because hydrateFromServer is a no-op when not authenticated.
 *
 * Closes a privacy/data-leak introduced by iter 17 (PR #82 — persisted
 * watchlist).
 */
import { useMarketStore, DEFAULT_WATCHLIST } from "@/stores/market";
import { useNotificationsStore } from "@/stores/notifications";
import { usePreferencesStore } from "@/stores/preferences";
import { useUIStore } from "@/stores/ui";

/**
 * The full set of per-user localStorage keys this helper wipes on sign-out.
 *
 * 4 zustand persist stores:
 *  - alphadesk-watchlist     (stores/market.ts)
 *  - alphadesk-notifications (stores/notifications.ts)
 *  - alphadesk-preferences   (stores/preferences.ts)
 *  - alphadesk-ui            (stores/ui.ts)
 *
 * Auxiliary per-user prefs that don't go through zustand persist:
 *  - alphadesk:keybindings        (hooks/useKeyboardShortcuts.ts)
 *  - alphadesk-watchlist-columns  (components/panels/WatchlistPanel.tsx)
 *
 * Exported for the unit test so it can iterate the same canonical list
 * the helper itself mutates.
 */
export const PERSIST_KEYS_TO_CLEAR = [
  "alphadesk-watchlist",
  "alphadesk-notifications",
  "alphadesk-preferences",
  "alphadesk-ui",
  "alphadesk:keybindings",
  "alphadesk-watchlist-columns",
] as const;

export function clearPersistedStores(): void {
  // 1. Reset in-memory zustand state FIRST. Each setState below mirrors
  //    the canonical initial state declared in the matching store file.
  //    Doing this before the localStorage wipe matters: zustand persist
  //    middleware writes back on every setState, so if we wipe first and
  //    set second, the persisted blob comes back populated with the
  //    defaults — we want the storage truly empty afterwards (assertable
  //    by the test, and observable to a fresh page load).
  try {
    // market.ts initial state — restore default watchlist + reset
    // selectedSymbol / groupSymbols / quotes. Quotes aren't persisted
    // but the in-memory copy can hold tickers the previous user added;
    // wipe so post-logout panels don't paint someone else's prices.
    useMarketStore.setState({
      quotes: {},
      watchlist: DEFAULT_WATCHLIST,
      selectedSymbol: "SPY",
      freshestTs: 0,
      groupSymbols: { 1: "SPY", 2: "SPY", 3: "SPY", 4: "SPY" },
    });

    // notifications.ts initial state — empty list.
    useNotificationsStore.setState({ notifications: [] });

    // preferences.ts exposes a first-class `resetAll()` that mirrors the
    // canonical initial state (defaultNotifications / defaultDisplay /
    // defaultData). Use it so this helper doesn't drift if the defaults
    // change.
    usePreferencesStore.getState().resetAll();

    // ui.ts has no `reset()` action — set the four persistable fields
    // directly. tradingMode goes back to "paper" (the safe default), and
    // the panel layout / sidebar / theme / palette state get the same
    // initial values as the create() factory.
    useUIStore.setState({
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
    });
  } catch (err) {
    // eslint-disable-next-line no-console -- intentional diagnostic
    console.warn("[clearPersistedStores] failed to reset in-memory state", err);
  }

  // 2. Wipe localStorage keys. Done AFTER the setState calls so the
  //    persist middleware's auto-write of the defaults is then erased,
  //    leaving localStorage truly empty. A fresh page load after this
  //    point will see no persisted state at all (the stores boot with
  //    their factory defaults).
  if (typeof window !== "undefined" && window.localStorage) {
    for (const key of PERSIST_KEYS_TO_CLEAR) {
      try {
        window.localStorage.removeItem(key);
      } catch (err) {
        // Some browsers throw on storage access (private mode, full quota,
        // etc). Swallow — sign-out should never throw.
        // eslint-disable-next-line no-console -- intentional diagnostic
        console.warn(`[clearPersistedStores] failed to remove ${key}`, err);
      }
    }
  }
}
