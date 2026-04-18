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
  return (
    <section
      data-slot="ai-memo-panel"
      aria-label="Claude memo"
      className={cn(
        "px-[18px] py-[18px] border-t border-border bg-ink-100",
        className
      )}
    >
      <header className="flex items-center gap-2 mb-2.5">
        <StatusDot tone="brand" pulse size={8} />
        <span
          className="font-sans font-semibold text-[9.5px] uppercase text-brand"
          style={{ letterSpacing: "0.2em" }}
        >
          Claude · Pre-trade memo
        </span>
        <span
          className="ml-auto font-mono text-[9.5px] text-fg-hint"
          style={{ letterSpacing: "0.06em" }}
        >
          {memo.timestamp}
        </span>
      </header>

      <p
        data-slot="ai-memo-body"
        className="font-display italic text-[15px] text-ink-900 leading-[1.4]"
        style={{ letterSpacing: "-0.005em" }}
      >
        {memo.text}
      </p>

      {memo.chips.length > 0 ? (
        <div className="flex gap-1.5 flex-wrap mt-3">
          {memo.chips.map((c, i) => (
            <span
              key={c.label + i}
              className={cn(
                "font-sans font-semibold text-[9px] uppercase px-[7px] py-[3px] rounded-xs border",
                chipClass[c.tone]
              )}
              style={{ letterSpacing: "0.14em" }}
            >
              {c.label}
            </span>
          ))}
        </div>
      ) : null}

      <footer className="flex justify-between mt-3 font-mono text-[10px] text-fg-muted">
        <span>Confidence {memo.confidence.toFixed(2)}</span>
        <span>
          {memo.model} · {memo.latencyMs} ms
        </span>
      </footer>
    </section>
  );
}
