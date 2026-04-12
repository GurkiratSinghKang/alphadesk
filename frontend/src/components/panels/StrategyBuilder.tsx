"use client";

import { useState } from "react";
import { Brain, Sparkles, Play, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

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
    // Simulate AI processing
    await new Promise(r => setTimeout(r, 1500));
    setAiThinking(false);
  };

  return (
    <div className="space-y-3">
      {/* Strategy Name */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Strategy Name</label>
        <input
          value={strategyName}
          onChange={(e) => setStrategyName(e.target.value)}
          className="w-full h-8 mt-1 rounded border border-border bg-background px-3 text-sm text-foreground"
        />
      </div>

      {/* Rule Input */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Add Rule (Natural Language)</label>
        <div className="flex gap-2 mt-1">
          <input
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
        <div className="rounded-lg border border-border bg-[var(--surface)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Examples — click to add</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_RULES.map((ex, i) => (
              <button
                key={i}
                onClick={() => { setInput(ex); }}
                className="rounded-full border border-border bg-[var(--panel)] px-2.5 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
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
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Rules ({rules.length})</p>
          <div className="space-y-1.5">
            {rules.map((rule) => (
              <div key={rule.id} className={cn(
                "flex items-start gap-2 rounded-lg border p-2.5",
                rule.valid ? "border-[var(--profit)]/30 bg-[var(--profit)]/5" : "border-amber-500/30 bg-amber-500/5"
              )}>
                <div className="flex-1">
                  <p className="text-xs text-foreground">{rule.condition}</p>
                  {rule.parsed && (
                    <div className="flex gap-2 mt-1">
                      {rule.parsed.action && <span className="text-[9px] rounded bg-[var(--profit)]/20 text-[var(--profit)] px-1.5 py-0.5 font-bold">{rule.parsed.action}</span>}
                      {rule.parsed.indicator && <span className="text-[9px] rounded bg-primary/20 text-primary px-1.5 py-0.5">{rule.parsed.indicator}</span>}
                      {rule.parsed.operator && <span className="text-[9px] rounded bg-[var(--panel)] text-muted-foreground px-1.5 py-0.5">{rule.parsed.operator}</span>}
                      {rule.parsed.value && <span className="text-[9px] rounded bg-[var(--panel)] text-foreground px-1.5 py-0.5 tabular-nums">{rule.parsed.value}</span>}
                    </div>
                  )}
                </div>
                <button onClick={() => removeRule(rule.id)} className="text-muted-foreground hover:text-[var(--loss)]">
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
            {aiThinking ? "Analyzing..." : "AI Refine"}
          </Button>
          <Button size="sm" className="text-xs gap-1.5">
            <Play className="h-3 w-3" /> Backtest
          </Button>
        </div>
      )}
    </div>
  );
}
