"use client";

import RegimePill, {
  type Regime,
  type RegimeVol,
} from "@/components/primitives/RegimePill";
import StatusDot from "@/components/primitives/StatusDot";
import { verdictPillToneClass } from "@/lib/verdictPillTone";
import type { Analysis, ClaudeStructured } from "@/types";

import {
  verdictBorderVar,
  verdictLabel,
  verdictTone,
  type VerdictTone,
} from "../_lib/verdictTone";

export interface DecisionStripMarketRegime {
  regime?: string | null;
  label?: string | null;
  vix_level?: number | null;
}

export interface DecisionStripProps {
  symbol: string;
  claudeStructured?: ClaudeStructured | null;
  analysis?: Analysis | null;
  marketRegime?: DecisionStripMarketRegime | null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function pickActionString(
  claudeStructured: ClaudeStructured | null | undefined,
  analysis: Analysis | null | undefined,
): string | null {
  if (claudeStructured?.suggestedPlay) return claudeStructured.suggestedPlay;
  if (analysis?.summary && analysis.summary.length > 0) return analysis.summary;
  return null;
}

function pickConviction(
  claudeStructured: ClaudeStructured | null | undefined,
  analysis: Analysis | null | undefined,
): number | null {
  if (analysis && Number.isFinite(analysis.composite)) {
    return clamp01(analysis.composite);
  }
  if (claudeStructured && Number.isFinite(claudeStructured.confidence)) {
    return clamp01(claudeStructured.confidence);
  }
  return null;
}

function normalizeRegime(
  raw: DecisionStripMarketRegime | null | undefined,
): { regime: Regime; vol?: RegimeVol; label: string } | null {
  if (!raw) return null;
  const r = (raw.regime || "").toLowerCase();
  const regime: Regime =
    r.includes("bull")
      ? "bull"
      : r.includes("bear")
        ? "bear"
        : r.includes("crisis") || r.includes("risk-off")
          ? "crisis"
          : "neutral";
  const vix = raw.vix_level ?? 0;
  const vol: RegimeVol | undefined =
    vix === 0 ? undefined : vix >= 30 ? "high" : vix >= 20 ? "elevated" : "low";
  const baseLabel = (raw.label && raw.label.toLowerCase()) || regime;
  return { regime, vol, label: `${baseLabel} (market-wide)` };
}

export function DecisionStrip({
  symbol,
  claudeStructured,
  analysis,
  marketRegime,
}: DecisionStripProps) {
  const action = pickActionString(claudeStructured, analysis);
  const tone: VerdictTone = verdictTone(action);
  const conviction = pickConviction(claudeStructured, analysis);
  const regime = normalizeRegime(marketRegime);

  const hasVerdict = action != null;
  const pillLabel = hasVerdict ? verdictLabel(tone) : null;
  const borderColor = verdictBorderVar(tone);
  // P1 audit (2026-05-06): confidence-bucket tone overrides the
  // setup-string mapping when conviction is known. A 30% "long call"
  // now reads warn-tone here too, matching EOP DecisionStrip's pill.
  // null conviction falls back to the existing verdictTone setup-string
  // border so the parity surface remains back-compat.
  const confidenceToneClass =
    conviction != null ? verdictPillToneClass(conviction) : null;

  return (
    <div
      role="region"
      aria-label="AI verdict and conviction"
      data-testid="decision-strip"
      data-slot="symbol-decision-strip"
      data-symbol={symbol}
      data-verdict-tone={tone}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        {hasVerdict && conviction != null ? (
          <span
            data-testid="verdict-pill"
            data-tone={tone}
            className={
              "inline-flex items-center gap-2 rounded-pill bg-bg-elev-1 px-3 py-1 font-display text-body-sm text-fg "
              + (confidenceToneClass ?? "border")
            }
            style={confidenceToneClass ? undefined : { borderColor }}
          >
            <span className="font-semibold tracking-wide">{pillLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="t-mono u-muted">
              {conviction.toFixed(2)} conviction
            </span>
          </span>
        ) : hasVerdict && conviction == null ? (
          <span
            data-testid="verdict-pill"
            data-tone={tone}
            className="inline-flex items-center gap-2 rounded-pill border bg-bg-elev-1 px-3 py-1 font-display text-body-sm text-fg"
            style={{ borderColor }}
          >
            <span className="font-semibold tracking-wide">{pillLabel}</span>
          </span>
        ) : (
          <span
            data-testid="verdict-pending"
            className="inline-flex items-center gap-2 rounded-pill border border-border bg-bg-elev-1 px-3 py-1 font-display text-body-sm u-muted"
          >
            <StatusDot tone="muted" size={8} />
            Analysis pending
          </span>
        )}

        {regime ? (
          <RegimePill
            data-testid="decision-strip-regime"
            regime={regime.regime}
            vol={regime.vol}
            label={regime.label}
          />
        ) : null}
      </div>

      {conviction != null ? (
        <div
          role="progressbar"
          aria-label="Conviction"
          aria-valuenow={conviction}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuetext={`${Math.round(conviction * 100)}%`}
          data-testid="conviction-bar"
          data-slot="conviction-bar"
          className="h-px w-full bg-border-hair"
        >
          <div
            data-testid="conviction-bar-fill"
            className="h-px bg-[var(--brand)]"
            style={{ width: `${conviction * 100}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export default DecisionStrip;
