"use client";

import { useState } from "react";
import { Brain, Sparkles, Play, Plus, X, AlertTriangle, Lightbulb, BarChart3, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { refineStrategy, type StrategyRefinement } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface StrategyRule {
  id: string;
  condition: string;
  parsed?: {
    indicator?: string;
    operator?: string;
    value?: string;
    action?: string;
  };
  valid: boolean;
}

const EXAMPLE_RULES = [
  "Buy when RSI(14) drops below 30",
  "Sell when price crosses above upper Bollinger Band",
  "Enter long when MACD crosses above signal line",
  "Exit when stop loss is hit at 3% below entry",
  "Only trade stocks with market cap > $10B",
  "Maximum position size: 5% of portfolio",
];

export function parseNaturalLanguage(text: string): NonNullable<StrategyRule["parsed"]> {
  const lower = text.toLowerCase();

  // Simple pattern matching for demo
  const indicators = ["rsi", "macd", "ema", "sma", "bollinger", "volume", "price", "atr"];
  const actions = ["buy", "sell", "enter", "exit", "long", "short"];
  const operators = ["above", "below", "crosses", "drops", "rises", "equals", "greater", "less"];

  const foundIndicator = indicators.find(i => lower.includes(i));
  const foundAction = actions.find(a => lower.includes(a));
  const foundOperator = operators.find(o => lower.includes(o));
  const foundValue = lower.match(/\d+\.?\d*/)?.[0];

  return {
    indicator: foundIndicator?.toUpperCase(),
    operator: foundOperator,
    value: foundValue,
    action: foundAction?.toUpperCase(),
  };
}

export function StrategyBuilder() {
  const [rules, setRules] = useState<StrategyRule[]>([]);
  const [input, setInput] = useState("");
  const [strategyName, setStrategyName] = useState("My Custom Strategy");
  const [aiThinking, setAiThinking] = useState(false);
  const [aiResult, setAiResult] = useState<StrategyRefinement | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [backtestRunning, setBacktestRunning] = useState(false);
  const { toast } = useToast();

  // Backtest requires at least a named strategy + one rule. The dedicated
  // runBacktest endpoint is not exposed in lib/api.ts yet (Wave 3 owns
  // api.ts), so we toast honestly when the user clicks and gate the
  // button on validity rather than pretending an engine exists.
  const canBacktest =
    strategyName.trim().length > 0 && rules.length > 0 && !backtestRunning;

  async function handleBacktest() {
    if (!canBacktest) return;
    setBacktestRunning(true);
    try {
      // No frontend wrapper for a backtest endpoint exists yet. Until it
      // lands, toast so the click is acknowledged instead of silent.
      toast({
        type: "info",
        message: "Backtest engine coming soon — AI refinement is available today",
      });
    } finally {
      setBacktestRunning(false);
    }
  }

  const addRule = () => {
    if (!input.trim()) return;
    const parsed = parseNaturalLanguage(input);
    const hasAction = !!parsed.action;
    const hasCondition = !!parsed.indicator || !!parsed.operator;

    setRules(prev => [...prev, {
      id: `rule-${Date.now()}`,
      condition: input.trim(),
      parsed,
      valid: hasAction || hasCondition,
    }]);
    setInput("");
  };

  const removeRule = (id: string) => {
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const handleAiRefine = async () => {
    setAiThinking(true);
    setAiError(null);
    try {
      const data = await refineStrategy(
        strategyName,
        rules.map(r => r.condition),
      );

      if (data.error) {
        setAiError(data.message ?? "AI refinement failed");
        return;
      }

      // Apply refined rules from Claude
      if (data.refined_rules && data.refined_rules.length > 0) {
        const newRules: StrategyRule[] = data.refined_rules.map((r, i) => ({
          id: `ai-rule-${Date.now()}-${i}`,
          condition: `${r.condition} -> ${r.action}`,
          parsed: {
            indicator: r.condition.match(/[A-Z]+/)?.[0],
            action: r.action,
          },
          valid: true,
        }));
        setRules(newRules);
      }

      setAiResult(data);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI refinement failed");
    } finally {
      setAiThinking(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Strategy Name */}
      <div>
        <label htmlFor="strategy-name" className="text-[12px] uppercase tracking-wider text-muted-foreground font-semibold">Strategy Name</label>
        <input
          id="strategy-name"
          value={strategyName}
          onChange={(e) => setStrategyName(e.target.value)}
          className="w-full h-8 mt-1 rounded border border-border bg-background px-3 text-sm text-foreground"
        />
      </div>

      {/* Rule Input */}
      <div>
        <label htmlFor="strategy-rule-input" className="text-[12px] uppercase tracking-wider text-muted-foreground font-semibold">Add Rule (Natural Language)</label>
        <div className="flex gap-2 mt-1">
          <input
            id="strategy-rule-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addRule(); }}
            placeholder='e.g. "Buy when RSI drops below 30"'
            className="flex-1 h-8 rounded border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground"
          />
          <Button onClick={addRule} size="sm" className="h-8 text-xs gap-1">
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
      </div>

      {/* Example Rules */}
      {rules.length === 0 && (
        <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="h-3.5 w-3.5 text-primary shrink-0" />
            <p className="text-[12px] uppercase tracking-wider text-primary font-semibold">Quick Start &mdash; click a rule to begin</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_RULES.map((ex, i) => (
              <button
                key={i}
                onClick={() => { setInput(ex); }}
                className="rounded-full border border-primary/20 bg-[var(--panel)] px-2.5 py-1 text-[12px] text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-primary/10 transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active Rules */}
      {rules.length > 0 && (
        <div>
          <p className="text-[12px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Rules ({rules.length})</p>
          <div className="space-y-1.5">
            {rules.map((rule) => (
              <div key={rule.id} className={cn(
                "flex items-start gap-2 rounded-lg border p-2.5",
                rule.valid ? "border-[var(--profit)]/30 bg-[var(--profit)]/5" : "border-amber-500/30 bg-amber-500/5"
              )}>
                <div className="flex-1">
                  <p className="text-xs text-foreground">{rule.condition}</p>
                  {rule.parsed && (
                    <div className="flex gap-2 mt-1 items-center">
                      {rule.parsed.action && <span className="text-[12px] rounded bg-[var(--profit)]/20 text-[var(--profit)] px-1.5 py-0.5 font-bold">{rule.parsed.action}</span>}
                      {rule.parsed.indicator && <span className="text-[12px] rounded bg-primary/20 text-primary px-1.5 py-0.5">{rule.parsed.indicator}</span>}
                      {rule.parsed.operator && <span className="text-[12px] rounded bg-[var(--panel)] text-muted-foreground px-1.5 py-0.5">{rule.parsed.operator}</span>}
                      {rule.parsed.value && <span className="text-[12px] rounded bg-[var(--panel)] text-foreground px-1.5 py-0.5 tabular-nums">{rule.parsed.value}</span>}
                      <span className="text-[12px] text-muted-foreground italic ml-1">NLP parsing</span>
                    </div>
                  )}
                </div>
                <button aria-label="Remove rule" onClick={() => removeRule(rule.id)} className="text-muted-foreground hover:text-[var(--loss)]">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {rules.length > 0 && (
        <div className="flex gap-2">
          <Button onClick={handleAiRefine} variant="outline" size="sm" className="text-xs gap-1.5" disabled={aiThinking}>
            {aiThinking ? <Sparkles className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
            {aiThinking ? "Analyzing with Claude..." : "Refine with AI"}
          </Button>
          <Button
            size="sm"
            className="text-xs gap-1.5"
            onClick={handleBacktest}
            disabled={!canBacktest}
          >
            {backtestRunning ? (
              <Sparkles className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {backtestRunning ? "Running..." : "Backtest"}
          </Button>
        </div>
      )}

      {/* AI Error */}
      {aiError && (
        <div className="rounded-lg border border-[var(--loss)]/30 bg-[var(--loss)]/5 p-3">
          <div className="flex items-center gap-2 text-[var(--loss)]">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <p className="text-xs">{aiError}</p>
          </div>
        </div>
      )}

      {/* AI Results Panel */}
      {aiResult && !aiError && (
        <div className="space-y-3">
          {/* Summary */}
          {aiResult.summary && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                <p className="text-[12px] uppercase tracking-wider text-primary font-semibold">AI Summary</p>
              </div>
              <p className="text-xs text-foreground leading-relaxed">{aiResult.summary}</p>
            </div>
          )}

          {/* Improvements */}
          {aiResult.improvements.length > 0 && (
            <div className="rounded-lg border border-border bg-[var(--surface)] p-3">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <p className="text-[12px] uppercase tracking-wider text-muted-foreground font-semibold">Suggested Improvements</p>
              </div>
              <ul className="space-y-1.5">
                {aiResult.improvements.map((imp, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                    <span className="text-muted-foreground mt-0.5 shrink-0">-</span>
                    <span>{imp}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risk Warnings */}
          {aiResult.risks.length > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <p className="text-[12px] uppercase tracking-wider text-amber-500 font-semibold">Risk Warnings</p>
              </div>
              <ul className="space-y-1.5">
                {aiResult.risks.map((risk, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-amber-400/90">
                    <span className="text-amber-500/50 mt-0.5 shrink-0">-</span>
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Backtest Parameters */}
          {aiResult.backtest_params && Object.keys(aiResult.backtest_params).length > 0 && (
            <div className="rounded-lg border border-border bg-[var(--surface)] p-3">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <p className="text-[12px] uppercase tracking-wider text-muted-foreground font-semibold">Recommended Backtest Parameters</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {aiResult.backtest_params.suggested_timeframe && (
                  <div>
                    <p className="text-[12px] text-muted-foreground uppercase">Timeframe</p>
                    <p className="text-xs text-foreground font-medium">{aiResult.backtest_params.suggested_timeframe}</p>
                  </div>
                )}
                {aiResult.backtest_params.lookback_period && (
                  <div>
                    <p className="text-[12px] text-muted-foreground uppercase">Lookback</p>
                    <p className="text-xs text-foreground font-medium">{aiResult.backtest_params.lookback_period}</p>
                  </div>
                )}
                {aiResult.backtest_params.position_size && (
                  <div>
                    <p className="text-[12px] text-muted-foreground uppercase">Position Size</p>
                    <p className="text-xs text-foreground font-medium">{aiResult.backtest_params.position_size}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
