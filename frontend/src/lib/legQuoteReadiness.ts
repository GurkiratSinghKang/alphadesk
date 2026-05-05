/**
 * Multi-leg ticket OCC quote-availability state machine.
 *
 * R6-5 (closes R5-B1, R5-M5)
 * ──────────────────────────
 * AlphaDesk's `/trade` route accepts multi-leg combo tickets via deep-link
 * (`?legs=OCC1:side:qty,OCC2:side:qty…`). Each leg's quote is fetched via
 * the per-symbol `/api/v1/market/quotes/{occ}` endpoint, which returns 404
 * when the OCC contract is not in the broker's chain (e.g. expired,
 * mistyped, or the snapshot cache hasn't warmed for that root). The
 * existing fan-out (`getSnapshot` in `lib/api.ts`) silently swallows
 * per-symbol 404s and returns a partial map.
 *
 * R4-W-3 closed this gap for the *singular* `activeContract` path. R5
 * confirmed (via `qa/runs/2026-05-04T20-31-40Z/trade/.../multi-leg-prefill`)
 * that the `activeLegs[]` path was untouched: a strangle deep-link with
 * both legs returning 404 rendered the underlying NVDA quote dressed as a
 * combo spread (`Two-sided quote live · spread $0.06 · 0.03%`) and the
 * execution-readiness pill claimed `2 passed checks` despite zero leg
 * data. A trader could submit a real-money order on bogus pricing.
 *
 * This module owns:
 * 1. The shape of per-leg unavailability records.
 * 2. The pure derivation of pill state (green/amber/coral) from those
 *    records — testable in isolation, no React, no DOM.
 * 3. Copy strings shown by the pill so they live next to the logic.
 *
 * The trade page wires this to:
 * - `setLegsUnavailable(records)` after `getSnapshot` resolves, recording
 *   any leg whose OCC was not in the result map.
 * - The `OrderBar` `legsUnavailable` prop, which renders a per-leg banner
 *   with a Retry button.
 * - The execution-readiness pill via `buildExecutionReadiness`, which now
 *   short-circuits to coral/amber when leg quotes are missing.
 */

/**
 * One missing-quote record per failing leg. The `reason` field is reserved
 * for future telemetry (timeout vs. 404 vs. generic 5xx) but today the
 * fan-out can only distinguish "missing from result map" — which we
 * conservatively classify as `404`.
 */
export interface LegQuoteUnavailable {
  /** OCC symbol of the leg whose quote was missing from the snapshot. */
  occ: string;
  /** Underlying ticker (NVDA, SPY, etc.) for human-readable display. */
  symbol: string;
  /** Why the quote is unavailable. */
  reason: "404" | "timeout" | "generic";
}

/**
 * Derived state for the execution-readiness pill driven by leg-quote
 * availability. Distinct from the ConfidenceCheck tones in the trade page
 * because this state machine has only three terminal states (no `pass`-
 * with-warnings). When all legs OK, callers fall through to the existing
 * pill logic (broker degraded, quote freshness, etc.).
 */
export interface LegReadinessState {
  /**
   * - `ready` — all legs returned a quote (or no legs are staged).
   * - `partial` — at least one leg failed but at least one succeeded; the
   *   user can still see priced legs but submit is gated.
   * - `blocked` — every staged leg failed; the combo cannot be priced.
   */
  status: "ready" | "partial" | "blocked";
  /** Pill color tone, matching ReadinessTone in trade/page.tsx. */
  tone: "profit" | "amber" | "loss";
  /** Compact pill label ("Ready" / "Review" / "Blocked"). */
  label: string;
  /** One-sentence headline shown alongside the pill. */
  headline: string;
  /** Detail copy with explicit count for the affected/total legs. */
  detail: string;
  /** Whether the user can submit the combo from this state. */
  canSubmit: boolean;
  /**
   * Short blocker copy shown in the "Submit blocker" panel. `null` when
   * `canSubmit` is true so the pill defers to the broader readiness logic.
   */
  blocker: string | null;
}

/**
 * Pure: derive pill state from staged-leg count and unavailable records.
 *
 * Called from both `buildExecutionReadiness` and unit tests. Independent of
 * React; safe to call during render.
 *
 * Invariants:
 * - Returns `ready` when no legs are staged (caller should defer).
 * - Returns `ready` when no legs have failed.
 * - Returns `partial` when 1..N-1 legs have failed.
 * - Returns `blocked` when every staged leg has failed.
 */
export function deriveLegReadiness({
  totalLegs,
  unavailable,
}: {
  totalLegs: number;
  unavailable: LegQuoteUnavailable[];
}): LegReadinessState {
  // No combo staged — this state machine is a no-op. Caller falls through
  // to the singular activeContract / equity-only readiness logic.
  if (totalLegs === 0) {
    return {
      status: "ready",
      tone: "profit",
      label: "Ready",
      headline: "Ticket can submit after final review",
      detail: "All staged legs have live quotes.",
      canSubmit: true,
      blocker: null,
    };
  }

  const failedCount = unavailable.length;

  if (failedCount === 0) {
    return {
      status: "ready",
      tone: "profit",
      label: "Ready",
      headline: "All legs have live quotes",
      detail: `${totalLegs} of ${totalLegs} legs returned a two-sided quote.`,
      canSubmit: true,
      blocker: null,
    };
  }

  if (failedCount >= totalLegs) {
    // Every staged leg failed. Submitting now would send an order against
    // bogus pricing (the underlying quote, not the combo). Coral / hard block.
    return {
      status: "blocked",
      tone: "loss",
      label: "Blocked",
      headline: "Cannot submit: no leg quotes available",
      detail: `All ${totalLegs} staged leg${totalLegs === 1 ? "" : "s"} failed to load. The displayed spread is the underlying — not the combo.`,
      canSubmit: false,
      blocker: `Cannot submit · ${failedCount} of ${totalLegs} leg quotes missing.`,
    };
  }

  // 1..N-1 legs failed. Amber / soft block: the combo is partially priced
  // but the trader must refresh before send.
  return {
    status: "partial",
    tone: "amber",
    label: "Review",
    headline: `Quote unavailable for ${failedCount} of ${totalLegs} legs`,
    detail: `Refresh the missing leg${failedCount === 1 ? "" : "s"} before submit. Combo pricing relies on every leg having a live two-sided quote.`,
    canSubmit: false,
    blocker: `Quote unavailable for ${failedCount} of ${totalLegs} legs — refresh before submit.`,
  };
}
