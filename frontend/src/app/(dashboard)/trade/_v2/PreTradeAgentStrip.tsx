"use client";

import * as React from "react";

import AgentChip from "@/components/primitives/AgentChip";
import { cn } from "@/lib/utils";

/**
 * PreTradeAgentStrip — v2 Phase 1.2 Trade terminal v2 chrome.
 *
 * Per v2-plan §1.2 + Phase 2 spec: every Trade ticket carries a
 * pre-execution agent stamp from Risk + Signal. The strip mounts
 * just below the cockpit header on /trade, voicing each archetype's
 * read on the staged order.
 *
 * Phase 0 ships a static demo with reasonable copy; backend B.2
 * (per-agent control) wires the live archetype-attributed memos.
 */
export interface PreTradeAgentStripProps {
  /** Symbol currently being traded; used in the body copy. */
  symbol: string | null | undefined;
  className?: string;
}

export default function PreTradeAgentStrip({
  symbol,
  className,
}: PreTradeAgentStripProps) {
  const sym = (symbol ?? "this name").toUpperCase();
  return (
    <section
      data-slot="pre-trade-agent-strip"
      className={cn(
        "flex flex-col sm:flex-row gap-3 rounded-md border border-border-hair bg-bg-elev-1 px-4 py-3",
        className,
      )}
    >
      <div className="shrink-0 flex sm:flex-col items-center sm:items-start gap-1.5">
        <span className="text-eyebrow uppercase tracking-[0.12em] text-brand font-semibold">
          Pre-trade
        </span>
        <span className="text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
          Agent stamps
        </span>
      </div>
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
        <article className="flex items-start gap-2">
          <AgentChip archetype="risk" status="running" size="sm" />
          <p className="font-display italic text-body-sm text-fg-dim leading-snug">
            {`Sector concentration on ${sym} sits inside cap. VaR contribution would rise ~4 bps. Approve.`}
          </p>
        </article>
        <article className="flex items-start gap-2">
          <AgentChip archetype="signal" status="running" size="sm" />
          <p className="font-display italic text-body-sm text-fg-dim leading-snug">
            {`Trend score 0.72 (long bias). Volume above 30d ADV; entry above 50d EMA. Confirm.`}
          </p>
        </article>
      </div>
    </section>
  );
}
