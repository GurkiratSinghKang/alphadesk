"use client";

import * as React from "react";

import ControlModule from "@/components/composites/ControlModule";
import Section from "@/components/composites/Section";
import { useControls } from "@/hooks/useControls";
import { type ControlCategory, type ControlSpec } from "@/lib/mocks";
import { cn } from "@/lib/utils";

/**
 * RuntimeControls
 * ────────────────
 * v2 redesign — runtime control modules grouped by category, per
 * v2-plan §1.6g. Each ControlSpec from MOCK_CONTROLS renders as a
 * single `<ControlModule>`. Categories shown:
 *   - Trade halt + order rate limits
 *   - Pipeline (per stage)
 *   - AI (per archetype + spend caps)
 *   - Strategies (per strategy)
 *   - Risk gates
 *   - Provider rails
 *   - Deploy dispatch
 *   - Feature flags
 *
 * Backend keys + Dashboard layout composer remain in the existing
 * AdminControlCenterClient panels (unchanged in Phase 0; see plan §1.6
 * for full Phase 1 swap).
 *
 * Each ControlSpec.surface drives the control element rendered:
 *   - switch        → toggle
 *   - input-number  → number input with unit suffix
 *   - input-secret  → masked input with rotate button
 *   - danger-button → button (DangerConfirm wired in Phase 1.6 follow-up)
 *   - segmented/select/slider → coming Phase 1.6 follow-up
 *
 * Phase 0 ships the read-only render pass with no mutations — every
 * surface is non-interactive until the backend B.1/B.2/B.6/B.8 endpoints
 * land. Operators see the full registry, organized as v2 specifies.
 */
export interface RuntimeControlsProps {
  /** Optional category filter. Default: render every category. */
  category?: ControlCategory;
  className?: string;
}

const CATEGORY_LABELS: Partial<Record<ControlCategory, string>> = {
  trade: "Trade",
  pipeline: "Pipeline",
  ai: "AI",
  strategies: "Strategies",
  risk: "Risk gates",
  data: "Provider rails",
  deploy: "Deploy",
  flags: "Feature flags",
};

const CATEGORY_ORDER: ControlCategory[] = [
  "trade",
  "pipeline",
  "ai",
  "strategies",
  "risk",
  "data",
  "deploy",
  "flags",
];

function renderControlSurface(spec: ControlSpec) {
  switch (spec.surface) {
    case "switch":
      return (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-6 w-10 items-center rounded-pill border px-0.5 transition-colors",
              spec.value
                ? "bg-profit/30 border-profit/60 justify-end"
                : "bg-bg-elev-2 border-border-hair justify-start",
            )}
            aria-hidden
          >
            <span
              className={cn(
                "h-5 w-5 rounded-full transition-colors",
                spec.value ? "bg-profit" : "bg-fg-muted/50",
              )}
            />
          </span>
          <span className="text-body-sm text-fg-muted">
            {spec.value ? "Enabled" : "Paused"}
          </span>
        </div>
      );
    case "input-number":
      return (
        <div className="flex items-baseline gap-2">
          <input
            type="number"
            readOnly
            defaultValue={spec.value as number}
            min={spec.min}
            max={spec.max}
            className="w-24 rounded-sm border border-border bg-bg-elev-1 px-2 py-1 text-body font-mono text-fg"
          />
          {spec.unit && (
            <span className="text-body-sm text-fg-muted">{spec.unit}</span>
          )}
        </div>
      );
    case "input-secret":
      return (
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={String(spec.value ?? "")}
            placeholder="paste new value"
            className={cn(
              "flex-1 rounded-sm border bg-bg-elev-1 px-2 py-1 text-body-sm font-mono",
              spec.critical
                ? "border-loss/60 text-loss"
                : "border-border text-fg-muted",
            )}
          />
          <button
            type="button"
            disabled
            className="rounded-sm border border-border bg-bg-elev-2 px-2.5 py-1 text-body-sm text-fg-muted opacity-50 cursor-not-allowed"
            title="Phase 1.6 will wire DangerConfirm rotate flow"
          >
            Rotate
          </button>
        </div>
      );
    case "danger-button":
      return (
        <button
          type="button"
          disabled
          className="rounded-sm border border-loss/60 bg-tint-down-1 px-3 py-1.5 text-body-sm text-loss font-semibold opacity-50 cursor-not-allowed"
          title="Phase 1.6 will wire DangerConfirm dispatch"
        >
          {spec.id.includes("halt")
            ? "Halt trading"
            : spec.id.includes("deploy")
            ? "Trigger deploy"
            : "Execute"}
        </button>
      );
    default:
      return (
        <span className="text-body-sm text-fg-muted italic">
          Surface &quot;{spec.surface}&quot; — Phase 1.6.
        </span>
      );
  }
}

export default function RuntimeControls({
  category,
  className,
}: RuntimeControlsProps) {
  const { data: controls = [] } = useControls(category ? { category } : {});

  const grouped = React.useMemo(() => {
    if (category) {
      return [{ category, items: controls }];
    }
    const map = new Map<ControlCategory, ControlSpec[]>();
    for (const cat of CATEGORY_ORDER) {
      const items = controls.filter((c) => c.category === cat);
      if (items.length > 0) map.set(cat, items);
    }
    return Array.from(map.entries()).map(([cat, items]) => ({ category: cat, items }));
  }, [category, controls]);

  return (
    <div
      data-slot="runtime-controls"
      className={cn("flex flex-col gap-8", className)}
    >
      {grouped.map(({ category: cat, items }) => (
        <div key={cat} id={`admin-cat-${cat}`} className="scroll-mt-24">
        <Section
          eyebrow={`ADMIN · ${cat.toUpperCase()}`}
          title={CATEGORY_LABELS[cat] ?? cat}
          description={`${items.length} control${items.length === 1 ? "" : "s"}`}
          rule
        >
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((spec) => (
              <ControlModule
                key={spec.id}
                name={spec.name}
                desc={spec.desc}
                control={renderControlSurface(spec)}
                critical={spec.critical}
                lastBy={spec.lastBy}
                lastAt={spec.lastAt}
                permission={spec.permission}
                auditHref={`/admin/control-center?focus=${spec.id}`}
              />
            ))}
          </div>
        </Section>
        </div>
      ))}
    </div>
  );
}
