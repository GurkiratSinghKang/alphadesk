"use client";

/**
 * Iter 25 — persist Settings → Preferences to the backend.
 *
 * Background: the Settings → Preferences card has five select dropdowns
 * (timezone, density, theme, number format, default landing page) plus a
 * header that promises "changes save automatically". Until this hook
 * landed every dropdown was uncontrolled — each `STSelect` rendered with
 * `defaultValue` and no `onChange`, so the user's picks vanished on
 * navigation and the header lied. Theme was the only field that already
 * round-tripped, via parent props.
 *
 * The backend already had a flat `appearance: Record<str, Any>` JSON
 * column on `UserSettings` and a PATCH endpoint at
 * `/api/v1/user/settings`. We store preferences as known keys on that
 * blob — no migration required.
 *
 * Shape:
 *   timezone:      IANA name, e.g. "America/New_York"
 *   density:       "comfortable" | "dense"
 *   theme:         "dark" | "light" | "system" (already wired through ThemeProvider)
 *   numberFormat:  "us" | "eu"
 *   landingPage:   path string, validated against ALLOWED_LANDING below
 *                  on the LoginForm read side (defence in depth — never
 *                  trust this value to be a safe URL).
 *
 * The hook is intentionally tolerant of unknown keys: the persisted blob
 * is `Record<string, unknown>` and callers always go through
 * `updatePreference(key, value)` which merges into the existing object.
 * That keeps us forward-compatible if a future iter adds, say, a
 * "currency" or "decimals" preference without needing to bump this hook.
 *
 * Iter 26 — Trading defaults persistence.
 * The same hook now exposes `updateTradingDefault(key, value)` which
 * persists under `appearance.tradingDefaults` so Settings → Trading
 * defaults can save the order ticket pre-fill values (order type,
 * time-in-force, sizing mode, confirm toggles, cost basis). Sharing the
 * `["user-settings-v2"]` cache key with iter 25 means the Preferences
 * card and the Trading defaults card make a single network round-trip
 * on first load + the Trade panel reads its defaults without an extra
 * fetch.
 */

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getUserSettingsV2,
  patchUserSettingsV2,
  type UserSettingsV2,
  type UserSettingsV2Patch,
} from "@/lib/api";

export const USER_SETTINGS_V2_QUERY_KEY = ["user-settings-v2"] as const;

// Whitelist of landing-page paths the LoginForm post-login redirect will
// honour. Exported so the LoginForm + tests can share the source of
// truth. Anything not on this list falls back to "/" — this prevents an
// open-redirect via a tampered settings row (the backend stores arbitrary
// JSON in `appearance`, so a compromised account could otherwise stash a
// URL like `https://evil.com/phish` and the LoginForm would dutifully
// navigate there).
export const ALLOWED_LANDING_PATHS = [
  "/",
  "/watchlists",
  "/trade",
  "/strategies",
  "/alerts",
] as const;

export type AllowedLandingPath = (typeof ALLOWED_LANDING_PATHS)[number];

const ALLOWED_LANDING_SET: ReadonlySet<string> = new Set(ALLOWED_LANDING_PATHS);

export function isAllowedLandingPath(path: unknown): path is AllowedLandingPath {
  return typeof path === "string" && ALLOWED_LANDING_SET.has(path);
}

/**
 * Resolve a candidate landing path against the whitelist. Returns "/"
 * for anything that is not a string on the allow-list. Used by the
 * LoginForm post-login redirect so a tampered preference can never
 * point the browser at an arbitrary external URL.
 */
export function resolveLandingPath(candidate: unknown): AllowedLandingPath {
  return isAllowedLandingPath(candidate) ? candidate : "/";
}

/**
 * Iter 26 — Trading defaults persistence shape.
 *
 * Stored as a nested object under `appearance.tradingDefaults`. Six
 * controls on Settings → Trading defaults populate this blob; the Trade
 * panel reads it on mount to pre-fill the order ticket. All values
 * mirror the on-screen STSelect / STToggle option literals (no
 * translation layer — the order ticket consumes the raw `v` from each
 * select), so adding a new option only needs the STTrading + ticket
 * sites updated. Unknown keys are tolerated — the hook merges into the
 * existing blob rather than replacing it, so a forward-compatible field
 * (e.g. a future "defaultStopPct") can be added without bumping this
 * interface.
 */
export interface UserTradingDefaults {
  defaultOrderType?: "market" | "limit" | "stop" | "stop-limit";
  defaultTimeInForce?: "day" | "gtc" | "ioc" | "fok";
  defaultSizing?: "risk" | "notional" | "shares";
  confirmMarketOrders?: boolean;
  confirmLargeOrders?: boolean;
  defaultCostBasis?: "fifo" | "lifo" | "spec" | "avg";
  [key: string]: unknown;
}

export interface UserAppearancePreferences {
  timezone?: string;
  density?: "comfortable" | "dense";
  theme?: "dark" | "light" | "system";
  numberFormat?: "us" | "eu";
  landingPage?: string;
  tradingDefaults?: UserTradingDefaults;
  [key: string]: unknown;
}

/**
 * Read the `appearance` JSON blob off a UserSettingsV2 row and coerce to
 * the typed shape. Returns null when the row hasn't loaded yet so
 * callers can fall back to UI defaults on first paint.
 */
function pickAppearance(
  settings: UserSettingsV2 | undefined,
): UserAppearancePreferences | null {
  if (!settings) return null;
  const blob = settings.appearance;
  if (!blob || typeof blob !== "object") return {};
  return blob as UserAppearancePreferences;
}

export interface UseUserPreferencesResult {
  /** Parsed appearance preferences, or null while the initial fetch is in flight. */
  preferences: UserAppearancePreferences | null;
  /** True while the initial GET is in flight. */
  isLoading: boolean;
  /** True while a PATCH is in flight (used by the "Saved" indicator). */
  isSaving: boolean;
  /**
   * Set when the most recent PATCH succeeded — the UI flashes a brief
   * "Saved" badge whenever this flips to true. Cleared by the next
   * mutation.
   */
  justSaved: boolean;
  /** Error from the most recent failed PATCH, or null. */
  saveError: Error | null;
  /**
   * Update a single appearance key. Optimistically merges into the
   * React Query cache so the UI flips before the PATCH completes;
   * rolls back on failure.
   */
  updatePreference: (key: string, value: unknown) => Promise<void>;
  /**
   * Iter 26 — convenience for the Trading defaults card. Merges
   * `{ [key]: value }` into `appearance.tradingDefaults`, preserving
   * sibling keys (so flipping one toggle doesn't drop the others).
   * Goes through the same mutation + optimistic update + rollback as
   * `updatePreference`, so callers get identical behaviour.
   */
  updateTradingDefault: (key: string, value: unknown) => Promise<void>;
}

/**
 * React Query-backed hook that exposes the user's appearance preferences
 * with a single `updatePreference(key, value)` mutator. Optimistic so
 * the UI flips on click; rolls the cache back on PATCH failure.
 */
export function useUserPreferences(): UseUserPreferencesResult {
  const queryClient = useQueryClient();

  const query = useQuery<UserSettingsV2>({
    queryKey: USER_SETTINGS_V2_QUERY_KEY,
    queryFn: getUserSettingsV2,
    staleTime: 5 * 60 * 1000, // 5 min — preferences are user-controlled, cache is fine
    retry: 1,
  });

  const mutation = useMutation<
    UserSettingsV2,
    Error,
    { key: string; value: unknown },
    { previous: UserSettingsV2 | undefined }
  >({
    mutationFn: async ({ key, value }) => {
      const current = queryClient.getQueryData<UserSettingsV2>(USER_SETTINGS_V2_QUERY_KEY);
      const existing = (current?.appearance ?? {}) as Record<string, unknown>;
      const patch: UserSettingsV2Patch = {
        appearance: { ...existing, [key]: value },
      };
      return patchUserSettingsV2(patch);
    },
    onMutate: async ({ key, value }) => {
      // Cancel any in-flight refetch so it doesn't clobber our optimistic update.
      await queryClient.cancelQueries({ queryKey: USER_SETTINGS_V2_QUERY_KEY });
      const previous = queryClient.getQueryData<UserSettingsV2>(USER_SETTINGS_V2_QUERY_KEY);
      if (previous) {
        const existing = (previous.appearance ?? {}) as Record<string, unknown>;
        queryClient.setQueryData<UserSettingsV2>(USER_SETTINGS_V2_QUERY_KEY, {
          ...previous,
          appearance: { ...existing, [key]: value },
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      // Roll back to the snapshot we took in onMutate so the dropdown
      // reverts to its prior value when the PATCH 4xx/5xxs.
      if (context?.previous) {
        queryClient.setQueryData(USER_SETTINGS_V2_QUERY_KEY, context.previous);
      }
    },
    onSuccess: (data) => {
      // Trust the server's response over our optimistic merge — the
      // backend may normalise unknown keys / strip null values.
      queryClient.setQueryData<UserSettingsV2>(USER_SETTINGS_V2_QUERY_KEY, data);
    },
  });

  const updatePreference = useCallback(
    async (key: string, value: unknown) => {
      // Fire and let the caller catch — the mutation itself owns the
      // optimistic update + rollback so callers don't have to.
      await mutation.mutateAsync({ key, value });
    },
    [mutation],
  );

  const updateTradingDefault = useCallback(
    async (key: string, value: unknown) => {
      // Read the current tradingDefaults sub-blob off the cache and
      // merge our key into it. We can't go through updatePreference
      // directly because that would replace the entire tradingDefaults
      // object — we want a per-key merge so unrelated trading defaults
      // survive the PATCH.
      const current = queryClient.getQueryData<UserSettingsV2>(USER_SETTINGS_V2_QUERY_KEY);
      const existingAppearance = (current?.appearance ?? {}) as Record<string, unknown>;
      const existingTradingDefaults =
        (existingAppearance.tradingDefaults as Record<string, unknown> | undefined) ?? {};
      const merged = { ...existingTradingDefaults, [key]: value };
      await mutation.mutateAsync({ key: "tradingDefaults", value: merged });
    },
    [mutation, queryClient],
  );

  return {
    preferences: pickAppearance(query.data),
    isLoading: query.isLoading,
    isSaving: mutation.isPending,
    justSaved: mutation.isSuccess && !mutation.isPending,
    saveError: mutation.error,
    updatePreference,
    updateTradingDefault,
  };
}
