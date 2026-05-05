"use client";

import { useState } from "react";
import {
  Shield,
  Rocket,
  GitMerge,
  Brain,
  Flame,
  Check,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getStrategies, toggleStrategy } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

// ─── Template Definitions ───────────────────────────────────

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
  sharpeRange: string;
  typicalDrawdown: string;
  strategies: string[];
  icon: typeof Shield;
}

// Batch B (P1-10) — TEMPLATES used to list 0-live strategies (claude-alpha,
// mean-reversion, vcp-breakout, dividend-capture, gap-fill — all marked
// `maxPositions: '0 live'` in strategy-content.ts) inside recommended
// bundles, alongside hard-coded `sharpeRange` / `typicalDrawdown` strings
// that were never derived from a backtest. The Sharpe and drawdown numbers
// kept for the templates below correspond to bundles that contain ONLY live
// strategies; bundles that included a 0-live strategy had that strategy
// dropped (rather than published a fabricated metric range that conflated
// research stubs with production behavior). When the dropped strategies
// graduate to live, restore them to their parent bundle and update the
// metric ranges from a real backtest.
const TEMPLATES: StrategyTemplate[] = [
  {
    id: "conservative-income",
    name: "Conservative Income",
    description:
      "VRP harvesting for steady income generation with minimal downside risk.",
    riskLevel: "low",
    sharpeRange: "0.8 - 1.2",
    typicalDrawdown: "3 - 5%",
    strategies: ["vrp-harvesting"],
    icon: Shield,
  },
  {
    id: "aggressive-growth",
    name: "Aggressive Growth",
    description:
      "Momentum-driven strategies targeting high-growth equities with strong technical setups.",
    riskLevel: "high",
    sharpeRange: "1.2 - 2.0",
    typicalDrawdown: "12 - 20%",
    strategies: ["momentum-quality"],
    icon: Rocket,
  },
  {
    id: "market-neutral",
    name: "Market Neutral",
    description:
      "Delta-neutral statistical-arbitrage pairs trading to profit regardless of market direction.",
    riskLevel: "medium",
    sharpeRange: "1.0 - 1.6",
    typicalDrawdown: "5 - 8%",
    strategies: ["pairs-trading"],
    icon: GitMerge,
  },
  {
    id: "ai-powered",
    name: "AI-Powered",
    description:
      "Regime-adaptive allocation that rotates between live AlphaDesk strategies based on the current market regime.",
    riskLevel: "medium",
    sharpeRange: "1.1 - 1.8",
    typicalDrawdown: "6 - 10%",
    strategies: ["regime-adaptive"],
    icon: Brain,
  },
  {
    id: "volatility-harvester",
    name: "Volatility Harvester",
    description:
      "Systematic volatility risk premium capture through VRP harvesting and earnings vol premium strategies.",
    riskLevel: "high",
    sharpeRange: "1.3 - 2.2",
    typicalDrawdown: "10 - 18%",
    strategies: ["vrp-harvesting", "earnings-vol-premium"],
    icon: Flame,
  },
];

const ALL_STRATEGY_IDS = [
  "momentum-quality",
  "pead",
  "vrp-harvesting",
  "earnings-vol-premium",
  "regime-adaptive",
  "claude-alpha",
  "mean-reversion",
  "vcp-breakout",
  "pairs-trading",
  "dividend-capture",
  "sector-rotation",
  "gap-fill",
  "manual-discretionary",
];

// QA r6-2 — risk tier chip palette migrated off raw Tailwind palettes
// (emerald/amber/red) to AlphaDesk semantic tokens. low=profit (chartreuse),
// medium=state-warning (mustard), high=loss (coral). Stays consistent with
// the rest of the risk-color story in DepthHeatStripe / StressTest.
const RISK_COLORS: Record<string, string> = {
  low: "border-[var(--profit)]/40 text-[var(--profit)] bg-[var(--profit)]/10",
  medium: "border-state-warning/40 text-state-warning bg-state-warning/10",
  high: "border-[var(--loss)]/40 text-[var(--loss)] bg-[var(--loss)]/10",
};

// ─── Template Card ──────────────────────────────────────────

function TemplateCard({
  template,
  activeId,
  onActivate,
}: {
  template: StrategyTemplate;
  activeId: string | null;
  onActivate: (id: string) => void;
}) {
  const Icon = template.icon;
  const isActive = activeId === template.id;

  return (
    <div
      className={cn(
        "rounded-xl border bg-[var(--surface)] p-4 transition-all",
        isActive
          ? "border-primary/50 ring-1 ring-primary/20"
          : "border-border hover:border-border/80"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "rounded-lg p-2",
              isActive ? "bg-primary/15" : "bg-[var(--panel)]"
            )}
          >
            <Icon
              className={cn(
                "h-4 w-4",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {template.name}
            </h3>
            <Badge
              variant="outline"
              className={cn("mt-0.5 text-label px-1.5 py-0", RISK_COLORS[template.riskLevel])}
            >
              {template.riskLevel.toUpperCase()} RISK
            </Badge>
          </div>
        </div>
        {isActive && (
          <Badge
            variant="outline"
            className="border-primary/40 text-primary bg-primary/10 text-label"
          >
            <Check className="h-2.5 w-2.5 mr-0.5" />
            Active
          </Badge>
        )}
      </div>

      <p className="mt-2.5 text-label text-muted-foreground leading-relaxed">
        {template.description}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-[var(--panel)] px-2.5 py-1.5">
          <p className="text-label uppercase tracking-wider text-muted-foreground">
            Sharpe
          </p>
          <p className="text-label font-semibold tabular-nums text-foreground">
            {template.sharpeRange}
          </p>
        </div>
        <div className="rounded-md bg-[var(--panel)] px-2.5 py-1.5">
          <p className="text-label uppercase tracking-wider text-muted-foreground">
            Max DD
          </p>
          <p className="text-label font-semibold tabular-nums text-foreground">
            {template.typicalDrawdown}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <p className="text-label text-muted-foreground mb-1.5">
          Strategies included:
        </p>
        <div className="flex flex-wrap gap-1">
          {template.strategies.map((sid) => (
            <span
              key={sid}
              className="rounded-md bg-[var(--panel)] px-2 py-0.5 text-label font-medium text-foreground"
            >
              {sid
                .split("-")
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" ")}
            </span>
          ))}
        </div>
      </div>

      <Button
        size="sm"
        variant={isActive ? "outline" : "default"}
        className="mt-3 w-full text-label h-7"
        onClick={() => onActivate(template.id)}
      >
        {isActive ? "Deactivate" : "Activate Template"}
      </Button>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────

interface StrategyTemplatesProps {
  open: boolean;
  onClose: () => void;
}

export function StrategyTemplates({ open, onClose }: StrategyTemplatesProps) {
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const { toast } = useToast();

  if (!open) return null;

  const handleActivate = async (templateId: string) => {
    if (activating) return;
    setActivating(true);

    try {
      const template = TEMPLATES.find((t) => t.id === templateId);
      if (!template) return;

      // Deactivate if already active (local visual — real toggles below)
      if (activeTemplate === templateId) {
        setActiveTemplate(null);
        setActivating(false);
        return;
      }

      // Read current state so we only toggle strategies whose state
      // actually needs to change. The previous implementation toggled every
      // strategy unconditionally which produced a half-random portfolio.
      let currentStates: Record<string, boolean> = {};
      try {
        const strategies = await getStrategies();
        currentStates = Object.fromEntries(
          strategies.map((s) => [s.id, (s.status ?? "").toLowerCase() === "active"])
        );
      } catch {
        toast({
          type: "error",
          message: "Couldn't read current strategy states — template cancelled.",
        });
        setActivating(false);
        return;
      }

      const enabledList: string[] = [];
      const disabledList: string[] = [];
      const togglePromises: Promise<unknown>[] = [];

      for (const sid of ALL_STRATEGY_IDS) {
        const shouldBeActive = template.strategies.includes(sid);
        const currentlyActive = currentStates[sid] === true;
        if (shouldBeActive && !currentlyActive) {
          enabledList.push(sid);
          togglePromises.push(toggleStrategy(sid).catch(() => null));
        } else if (!shouldBeActive && currentlyActive) {
          disabledList.push(sid);
          togglePromises.push(toggleStrategy(sid).catch(() => null));
        }
        // Else: already in the desired state — do nothing.
      }

      await Promise.allSettled(togglePromises);
      setActiveTemplate(templateId);
      toast({
        type: "success",
        message: `Applying template: enabled ${enabledList.length}, disabled ${disabledList.length}`,
      });
    } catch {
      toast({ type: "error", message: "Template activation failed" });
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 mx-4 w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-[var(--panel)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-[var(--panel)] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-bold text-foreground">
                Strategy Templates
              </h2>
              <p className="text-label text-muted-foreground">
                One-click portfolio configurations — activate to enable included
                strategies
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activating && (
              <div className="flex items-center gap-1.5 text-label text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Applying...
              </div>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close templates"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              activeId={activeTemplate}
              onActivate={handleActivate}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
