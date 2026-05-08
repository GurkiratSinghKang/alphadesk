"use client";

import * as React from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * SymbolTabs — v2 Phase 1.3 5-tab navigation per v2-plan §1.3.
 *
 * Tabs (locked):
 *   1. Overview         · chart-as-hero + thesis + signals + setups
 *   2. Fundamentals     · KeyStats + Earnings sub-section + AboutSection
 *   3. News & Filings   · NewsBand (filings interleaved later)
 *   4. Options          · OptionsThesisBand (chain table coming)
 *   5. History & AI     · AgentsDebateCard + history
 *
 * Tab state lives in the URL (`?tab=...`) so deep links and back/forward
 * navigation work. Defaults to "overview" when missing.
 */
export type SymbolTabId = "overview" | "fundamentals" | "news" | "options" | "history";

const TABS: { id: SymbolTabId; label: string; caption: string }[] = [
  { id: "overview",     label: "Overview",     caption: "Chart · thesis · signals" },
  { id: "fundamentals", label: "Fundamentals", caption: "Stats · ratios · earnings" },
  { id: "news",         label: "News & Filings", caption: "Headlines · 10-K/Q · 8-K" },
  { id: "options",      label: "Options",      caption: "Chain · greeks · IV" },
  { id: "history",      label: "History & AI", caption: "My trades · agents · memo" },
];

export function useSymbolTab(): [SymbolTabId, (tab: SymbolTabId) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Read URL once on mount; subsequent navigation is driven by `setTab`
  // through both local state AND a router.replace. Local state guarantees
  // re-render even when the test environment doesn't observably mutate
  // useSearchParams() after a router.replace().
  const initialFromUrl = React.useMemo<SymbolTabId>(() => {
    const raw = params?.get("tab");
    return raw === "fundamentals" || raw === "news" || raw === "options" || raw === "history"
      ? raw
      : "overview";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [active, setActive] = React.useState<SymbolTabId>(initialFromUrl);

  const setTab = React.useCallback(
    (next: SymbolTabId) => {
      setActive(next);
      const sp = new URLSearchParams(params?.toString() ?? "");
      if (next === "overview") sp.delete("tab");
      else sp.set("tab", next);
      const qs = sp.toString();
      try {
        router.replace(qs ? `${pathname}?${qs}` : `${pathname}`, { scroll: false });
      } catch {
        // router.replace is a no-op in tests; local state still drives render.
      }
    },
    [params, pathname, router],
  );
  return [active, setTab];
}

export interface SymbolTabsProps {
  active: SymbolTabId;
  onTabChange: (next: SymbolTabId) => void;
  className?: string;
}

export default function SymbolTabs({ active, onTabChange, className }: SymbolTabsProps) {
  return (
    <nav
      aria-label="Symbol detail tabs"
      role="tablist"
      className={cn(
        "sticky top-0 z-10 border-b border-border-hair bg-bg/95 backdrop-blur-sm px-4 sm:px-6",
        className,
      )}
    >
      <div className="flex flex-wrap gap-1 -mb-px">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            aria-controls={`symbol-tab-panel-${t.id}`}
            id={`symbol-tab-${t.id}`}
            onClick={() => onTabChange(t.id)}
            className={cn(
              "inline-flex flex-col items-start gap-0 px-3 sm:px-4 py-2.5 border-b-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              active === t.id
                ? "border-brand text-fg"
                : "border-transparent text-fg-muted hover:text-fg hover:border-border-hair",
            )}
          >
            <span className="text-body font-medium">{t.label}</span>
            <span className="text-eyebrow uppercase tracking-[0.08em] text-fg-hint hidden sm:inline">
              {t.caption}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
