"use client";

import * as React from "react";

import { useControls } from "@/hooks/useControls";
import { cn } from "@/lib/utils";
import type { ControlCategory } from "@/lib/mocks/controls";

/**
 * AdminCategoryRail
 * ──────────────────
 * v2-plan §1.6 — sticky left sub-rail with jump-to-category nav. Each
 * category lists count + "needs attention" coral dot when any module in
 * that category is critical.
 *
 * Active state is driven by IntersectionObserver on the `#admin-cat-{id}`
 * anchors that RuntimeControls renders.
 */
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

const CATEGORY_LABELS: Record<ControlCategory, string> = {
  trade: "Trade",
  pipeline: "Pipeline",
  ai: "AI",
  strategies: "Strategies",
  risk: "Risk gates",
  data: "Provider rails",
  deploy: "Deploy",
  flags: "Feature flags",
  // categories that aren't part of the runtime grid (rendered elsewhere)
  keys: "Backend keys",
  layout: "Dashboard layout",
  features: "Features",
  agents: "Agents",
};

export default function AdminCategoryRail() {
  const { data: controls = [] } = useControls();
  const [active, setActive] = React.useState<ControlCategory | null>(null);

  const counts = React.useMemo(() => {
    const out: Partial<Record<ControlCategory, { total: number; critical: number }>> = {};
    for (const c of controls) {
      const slot = out[c.category] ?? { total: 0, critical: 0 };
      slot.total += 1;
      if (c.critical) slot.critical += 1;
      out[c.category] = slot;
    }
    return out;
  }, [controls]);

  // Track which `#admin-cat-{cat}` is closest to the top of the viewport.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const targets = CATEGORY_ORDER.map((cat) => document.getElementById(`admin-cat-${cat}`)).filter(
      (el): el is HTMLElement => Boolean(el),
    );
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) {
          const id = visible.target.id.replace("admin-cat-", "") as ControlCategory;
          setActive(id);
        }
      },
      { rootMargin: "-100px 0px -65% 0px", threshold: 0 },
    );
    for (const t of targets) observer.observe(t);
    return () => observer.disconnect();
  }, [controls.length]);

  function jump(cat: ControlCategory) {
    if (typeof window === "undefined") return;
    const el = document.getElementById(`admin-cat-${cat}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(cat);
    }
  }

  return (
    <nav
      aria-label="Control category jump nav"
      className="sticky top-24 self-start"
    >
      <p className="t-label text-fg-hint mb-2">CATEGORIES</p>
      <ol className="rounded-md border border-border-hair bg-bg-elev-1 divide-y divide-border-hair overflow-hidden">
        {CATEGORY_ORDER.filter((cat) => (counts[cat]?.total ?? 0) > 0).map((cat) => {
          const c = counts[cat] ?? { total: 0, critical: 0 };
          const isActive = active === cat;
          return (
            <li key={cat}>
              <button
                type="button"
                onClick={() => jump(cat)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  isActive
                    ? "bg-bg-elev-2 text-fg border-l-2 border-brand"
                    : "border-l-2 border-transparent text-fg-muted hover:text-fg hover:bg-bg-elev-2",
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {c.critical > 0 && (
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full bg-loss"
                      title={`${c.critical} critical`}
                    />
                  )}
                  <span className="text-body-sm truncate">{CATEGORY_LABELS[cat]}</span>
                </span>
                <span className="font-mono text-eyebrow text-fg-hint tabular-nums">
                  {c.total}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
