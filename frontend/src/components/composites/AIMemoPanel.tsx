import * as React from "react";

import { cn } from "@/lib/utils";
import StatusDot from "@/components/primitives/StatusDot";
import type { AIMemo } from "./types";

/**
 * AIMemoPanel (composite)
 * ───────────────────────
 * Gold pulsing StatusDot · tracked-caps eyebrow "Claude · Pre-trade memo" ·
 * italic-serif memo body · chip row (Regime fit / Risk ok / Earn 14d) ·
 * confidence + model / latency footer.
 *
 * The memo text may contain inline emphasis — the parent can insert
 * `<em>` spans directly by passing a React node in `memo.text` if they
 * need gold callouts. Keep this composite presentation-only.
 */
export interface AIMemoPanelProps {
  memo: AIMemo;
  className?: string;
}

const chipClass: Record<AIMemo["chips"][number]["tone"], string> = {
  profit: "text-up-500 bg-up-500/10 border-up-500/25",
  loss: "text-down-500 bg-down-500/10 border-down-500/25",
  ice: "text-ice bg-ice/10 border-ice/25",
  muted: "text-fg-muted bg-bg-elev-1 border-border",
};

export default function AIMemoPanel({ memo, className }: AIMemoPanelProps) {
  // `emptyMemo` in the desk selectors sets `model: "awaiting"` as a signal
  // that no real Claude memo has been produced yet — the footer
  // "Confidence 0.00 · awaiting · 0 ms" would read as broken telemetry, so
  // we suppress it until a real model response arrives. Optional chaining
  // guards against callers that omit any of the optional fields.
  const isAwaiting =
    memo?.model === "awaiting" ||
    memo?.model === undefined ||
    memo?.model === "";
  const confidence = typeof memo?.confidence === "number" && Number.isFinite(memo.confidence)
    ? memo.confidence
    : null;
  const latencyMs = typeof memo?.latencyMs === "number" && Number.isFinite(memo.latencyMs)
    ? memo.latencyMs
    : null;
  const showFooter = !isAwaiting && confidence !== null && latencyMs !== null;

  return (
    <section
      data-slot="ai-memo-panel"
      aria-label="Claude memo"
      className={cn(
        "px-4 py-4 sm:px-[18px] sm:py-[18px] border-t border-border bg-ink-100",
        className
      )}
    >
      <header className="flex items-center gap-2 mb-2.5">
        <StatusDot tone="brand" pulse size={8} />
        <span className="t-label text-brand">
          Claude · Pre-trade memo
        </span>
        <span className="ml-auto t-meta text-fg-hint">
          {memo?.timestamp}
        </span>
      </header>

      <p
        data-slot="ai-memo-body"
        className="t-section-cap text-ink-900 leading-[1.4]"
      >
        {memo?.text}
      </p>

      {memo?.chips && memo.chips.length > 0 ? (
        <div className="flex gap-1.5 flex-wrap mt-3">
          {memo.chips.map((c, i) => (
            <span
              key={c.label + i}
              className={cn(
                "t-label px-[7px] py-[3px] rounded-xs border",
                chipClass[c.tone]
              )}
            >
              {c.label}
            </span>
          ))}
        </div>
      ) : null}

      {showFooter ? (
        <footer className="flex flex-wrap justify-between gap-x-2 gap-y-1 mt-3 t-meta">
          <span className="shrink-0">Confidence {confidence!.toFixed(2)}</span>
          <span className="truncate max-w-[60%] text-right">
            {memo!.model} · {latencyMs} ms
          </span>
        </footer>
      ) : null}
    </section>
  );
}
