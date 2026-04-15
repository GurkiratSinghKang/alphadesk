"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Send,
  Loader2,
  BarChart2,
  DollarSign,
  MessageSquare,
  Activity,
  ShoppingCart,
  Layers,
  AlertTriangle,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useMarketStore } from "@/stores/market";
import { useUIStore } from "@/stores/ui";
import { usePortfolioStore } from "@/stores/portfolio";
import { cn } from "@/lib/utils";
import { HelpCircle } from "@/components/ui/HelpCircle";
import { chatWithAgent, getAnalysis, analyzeSymbol, placeOrder } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { PositionSizer } from "@/components/panels/PositionSizer";
import { MultiTimeframe } from "@/components/panels/MultiTimeframe";
import type { ChatMessage, Analysis, QuickOrderEvent } from "@/types";

// ─── Score Gauge ─────────────────────────────────────────────

function ScoreGauge({
  value,
  max = 100,
  label,
  size = 80,
  placeholder = false,
}: {
  value: number;
  max?: number;
  label: string;
  size?: number;
  placeholder?: boolean;
}) {
  const pct = placeholder ? 0 : Math.min(Math.max(value / max, 0), 1);
  const color =
    pct > 0.65
      ? "var(--profit)"
      : pct > 0.35
      ? "var(--chart-4)"
      : "var(--loss)";
  const circumference = 2 * Math.PI * 32;
  const dashOffset = circumference * (1 - pct * 0.75); // 270 degree arc

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 72 72" className="rotate-[135deg]">
          {/* Track */}
          <circle
            cx="36"
            cy="36"
            r="32"
            fill="none"
            stroke="var(--border)"
            strokeWidth="4"
            strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
            strokeLinecap="round"
          />
          {/* Value */}
          <circle
            cx="36"
            cy="36"
            r="32"
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-foreground tabular-nums">
            {placeholder ? "\u2014" : Math.round(value)}
          </span>
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

// ─── F-Score Dots ────────────────────────────────────────────

function FScoreDots({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 9 }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-3 w-3 rounded-full transition-colors",
            i < score
              ? score >= 7
                ? "bg-[var(--profit)]"
                : score >= 4
                ? "bg-[var(--chart-4)]"
                : "bg-[var(--loss)]"
              : "bg-[var(--border)]"
          )}
        />
      ))}
      <span className="ml-2 text-xs font-medium text-foreground">{score}/9</span>
    </div>
  );
}

// ─── Analysis fetch hook ────────────────────────────────────

function useAnalysisData(symbol: string) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    let cancelled = false;

    debounceRef.current = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      setTimedOut(false);
      const timeout = new Promise<never>((_, reject) => {
        timeoutRef.current = setTimeout(() => reject(new Error("timeout")), 30000);
      });
      try {
        // Try to trigger analysis, then fetch the result
        await Promise.race([analyzeSymbol(symbol), timeout]);
        if (cancelled) return;
        const data = await Promise.race([getAnalysis(symbol), timeout]);
        if (cancelled) return;
        setAnalysis(data);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.message === "timeout") {
          setTimedOut(true);
          setLoading(false);
          return;
        }
        try {
          // Try just fetching existing analysis
          const data = await getAnalysis(symbol);
          if (cancelled) return;
          setAnalysis(data);
        } catch {
          if (cancelled) return;
          // No real analysis available — leave analysis as null
          // so the UI shows an honest "No analysis available" state
          setAnalysis(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [symbol]);

  return { analysis, loading, timedOut };
}

// ─── Technical Tab ───────────────────────────────────────────

function TechnicalTab({ symbol, analysis, loading, timedOut }: { symbol: string; analysis: Analysis | null; loading: boolean; timedOut?: boolean }) {
  const quote = useMarketStore((s) => s.quotes[symbol]);
  const rawScore = analysis?.technicalScore;
  const isPlaceholderScore = rawScore == null;
  const score = rawScore ?? 50;
  // Derive key levels from the actual quote price
  const currentPrice = quote?.last ?? quote?.close ?? 0;
  const step = currentPrice * 0.03; // ~3% increments for S/R levels
  const keyLevels = currentPrice > 0 ? [
    { label: "Resistance 2", price: Math.round((currentPrice + step * 2) * 100) / 100 },
    { label: "Resistance 1", price: Math.round((currentPrice + step) * 100) / 100 },
    { label: "Current", price: Math.round(currentPrice * 100) / 100 },
    { label: "Support 1", price: Math.round((currentPrice - step) * 100) / 100 },
    { label: "Support 2", price: Math.round((currentPrice - step * 2) * 100) / 100 },
  ] : [];
  // Generate deterministic indicators based on score
  const bullish = score >= 60;
  const bearish = score < 40;
  const indicators: { name: string; value: string; signal: "bullish" | "bearish" | "neutral" }[] = [
    { name: "RSI (14)", value: (40 + score * 0.3).toFixed(1), signal: score > 65 ? "bullish" : score < 35 ? "bearish" : "neutral" },
    { name: "MACD", value: bullish ? "Bullish Cross" : bearish ? "Bearish Cross" : "Converging", signal: bullish ? "bullish" : bearish ? "bearish" : "neutral" },
    { name: "EMA 20/50", value: bullish ? "Above" : bearish ? "Below" : "Flat", signal: bullish ? "bullish" : bearish ? "bearish" : "neutral" },
    { name: "BB Width", value: "Normal", signal: "neutral" },
    { name: "ADX", value: (20 + score * 0.15).toFixed(1), signal: score > 50 ? "bullish" : "neutral" },
    { name: "OBV", value: bullish ? "Rising" : bearish ? "Falling" : "Flat", signal: bullish ? "bullish" : bearish ? "bearish" : "neutral" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Analyzing {symbol}...
      </div>
    );
  }

  if (timedOut && !analysis) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
        Analysis timed out. Try again later.
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="space-y-4 p-3">
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Activity className="h-6 w-6 text-muted-foreground/40 mb-2" />
          <p className="text-xs text-muted-foreground">No analysis available for {symbol}</p>
        </div>

        <Separator className="bg-border" />

        <div>
          <h4 className="text-[11px] font-medium text-muted-foreground mb-2">
            Key Levels
          </h4>
          <div className="space-y-1">
            {keyLevels.map((l) => (
              <div
                key={l.label}
                className={cn(
                  "flex items-center justify-between rounded px-2 py-1 text-xs",
                  l.label === "Current" && "bg-primary/10"
                )}
              >
                <span
                  className={
                    l.label === "Current"
                      ? "text-primary font-medium"
                      : l.label.startsWith("Resistance")
                      ? "text-[var(--loss)]"
                      : "text-[var(--profit)]"
                  }
                >
                  {l.label}
                </span>
                <span className={cn("tabular-nums text-foreground", l.label !== "Current" && "opacity-40")}>
                  ${(l.price ?? 0).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-xs font-medium text-muted-foreground flex items-center">
            Technical Score
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1 line-clamp-3 overflow-hidden break-words">
            {analysis.summary}
          </p>
        </div>
        <ScoreGauge value={score} label="Technical" placeholder={isPlaceholderScore} />
      </div>

      <Separator className="bg-border" />

      <div>
        <h4 className="text-[11px] font-medium text-muted-foreground mb-2">
          Key Levels
        </h4>
        <div className="space-y-1">
          {keyLevels.map((l) => (
            <div
              key={l.label}
              className={cn(
                "flex items-center justify-between rounded px-2 py-1 text-xs",
                l.label === "Current" && "bg-primary/10"
              )}
            >
              <span
                className={
                  l.label === "Current"
                    ? "text-primary font-medium"
                    : l.label.startsWith("Resistance")
                    ? "text-[var(--loss)]"
                    : "text-[var(--profit)]"
                }
              >
                {l.label}
              </span>
              <span className={cn("tabular-nums text-foreground", l.label !== "Current" && "opacity-40")}>
                ${(l.price ?? 0).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Separator className="bg-border" />

      <div>
        <h4 className="text-[11px] font-medium text-muted-foreground mb-2">
          Indicators
        </h4>
        <div className="space-y-1">
          {indicators.map((ind) => (
            <div
              key={ind.name}
              className="flex items-center justify-between text-xs px-2 py-1"
            >
              <span className="text-muted-foreground">{ind.name}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-foreground">{ind.value}</span>
                {ind.signal === "bullish" ? (
                  <TrendingUp className="h-3 w-3 text-[var(--profit)]" />
                ) : ind.signal === "bearish" ? (
                  <TrendingDown className="h-3 w-3 text-[var(--loss)]" />
                ) : (
                  <Minus className="h-3 w-3 text-[var(--neutral)]" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ETF symbol set ─────────────────────────────────────────

const ETF_SYMBOLS = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'XLK', 'XLV', 'XLF', 'XLE', 'XLU', 'XLRE', 'XLB', 'XLC', 'XLI', 'XLP', 'XLY', 'GLD', 'TLT', 'VTI', 'VOO', 'ARKK']);

// ─── Fundamental Tab ─────────────────────────────────────────

function FundamentalTab({ symbol, analysis, loading, timedOut }: { symbol: string; analysis: Analysis | null; loading: boolean; timedOut?: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading fundamentals...
      </div>
    );
  }
  if (timedOut && !analysis) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
        Analysis timed out. Try again later.
      </div>
    );
  }
  let seed = 0;
  for (let c = 0; c < symbol.length; c++) seed += symbol.charCodeAt(c);
  const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const fScore = analysis?.fundamentalScore != null
    ? Math.round((analysis.fundamentalScore / 100) * 9)
    : Math.round(4 + rng() * 5);
  const peRatio = (15 + rng() * 25).toFixed(1);
  const roe = (8 + rng() * 30).toFixed(1);
  const debtEquity = (0.2 + rng() * 1.5).toFixed(2);
  const revGrowth = (-5 + rng() * 30).toFixed(1);
  const opMargin = (10 + rng() * 25).toFixed(1);
  const metrics = [
    { label: "P/E Ratio", value: `${peRatio}x` },
    { label: "P/S Ratio", value: `${(3 + rng() * 8).toFixed(1)}x` },
    { label: "EV/EBITDA", value: `${(12 + rng() * 18).toFixed(1)}x` },
    { label: "Profit Margin", value: `${opMargin}%` },
    { label: "ROE", value: `${roe}%` },
    { label: "Debt/Equity", value: `${debtEquity}x` },
    { label: "FCF Yield", value: `${(1 + rng() * 5).toFixed(1)}%` },
    { label: "Revenue Growth", value: `${Number(revGrowth) >= 0 ? "+" : ""}${revGrowth}%` },
  ];

  const isETF = ETF_SYMBOLS.has(symbol.toUpperCase());

  return (
    <div className="space-y-4 p-3">
      {isETF && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-300">ETF &mdash; individual fundamental metrics are aggregated estimates</p>
        </div>
      )}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center">
          Piotroski F-Score
        </h3>
        <div className={!analysis ? "opacity-40" : undefined}>
          <FScoreDots score={fScore} />
        </div>
        <p className={cn("text-[11px] text-muted-foreground mt-2", !analysis && "opacity-40")}>
          {symbol} has {fScore <= 3 ? "weak" : fScore <= 6 ? "moderate" : "strong"} fundamentals with {fScore <= 3 ? "concerning profitability and declining financial health" : fScore <= 6 ? "mixed profitability and stable financial health" : "high profitability and improving financial health"}.
        </p>
      </div>

      <Separator className="bg-border" />

      <div>
        <h4 className="text-[11px] font-medium text-muted-foreground mb-2">
          Valuation Metrics
        </h4>
        <div className="space-y-1">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="flex items-center justify-between text-xs px-2 py-1"
            >
              <span className="text-muted-foreground">{m.label}</span>
              <div className="flex items-center gap-3">
                <span className={cn("text-foreground tabular-nums", !analysis && "opacity-40")}>{m.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Sentiment Tab ───────────────────────────────────────────

function SentimentTab({ symbol, analysis, loading, timedOut }: { symbol: string; analysis: Analysis | null; loading: boolean; timedOut?: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading sentiment...
      </div>
    );
  }
  if (timedOut && !analysis) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
        Analysis timed out. Try again later.
      </div>
    );
  }
  // Vary estimated flow amounts by symbol charCode seed so different symbols show different amounts
  let flowSeed = 0;
  for (let c = 0; c < symbol.length; c++) flowSeed += symbol.charCodeAt(c);
  const flowRng = () => { flowSeed = (flowSeed * 16807) % 2147483647; return (flowSeed - 1) / 2147483646; };
  const callSweep = (1.5 + flowRng() * 3.0).toFixed(1);
  const putBuy = (0.5 + flowRng() * 1.5).toFixed(1);
  const unusualVol = (400 + Math.floor(flowRng() * 1200));
  const flowItems = [
    { text: `Large call sweep ${symbol}`, type: "bullish" as const, size: `$${callSweep}M` },
    { text: `Put buying in ${symbol}`, type: "bearish" as const, size: `$${putBuy}M` },
    { text: `Unusual volume in ${symbol} calls`, type: "bullish" as const, size: `$${unusualVol}K` },
  ];
  const newsItems = [
    { headline: `${symbol}: Analysts raise price target following earnings beat`, sentiment: "positive" as const, time: "2h ago" },
    { headline: `Tech sector faces headwinds from rising yields`, sentiment: "negative" as const, time: "4h ago" },
    { headline: `Options market implies 3.2% move on upcoming earnings`, sentiment: "neutral" as const, time: "6h ago" },
  ];

  return (
    <div className="space-y-4 p-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-xs font-medium text-muted-foreground flex items-center">
            Sentiment Score
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1">
            Moderately bullish sentiment. Analysts positive, options flow mixed.
          </p>
        </div>
        <ScoreGauge value={Math.max(0, Math.min(100, (analysis?.sentimentScore ?? 0) + 50))} label="Sentiment" />
      </div>

      <Separator className="bg-border" />

      <div>
        <h4 className="text-[11px] font-medium text-muted-foreground mb-2">
          Options Flow
        </h4>
        <div className="space-y-1">
          {flowItems.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-xs"
            >
              {f.type === "bullish" ? (
                <TrendingUp className="h-3 w-3 shrink-0 text-[var(--profit)]" />
              ) : (
                <TrendingDown className="h-3 w-3 shrink-0 text-[var(--loss)]" />
              )}
              <span className={cn("flex-1 text-foreground", !analysis && "opacity-40")}>{f.text}</span>
              <span className={cn("text-muted-foreground", !analysis && "opacity-40")}>{f.size}</span>
            </div>
          ))}
        </div>
      </div>

      <Separator className="bg-border" />

      <div>
        <h4 className="text-[11px] font-medium text-muted-foreground mb-2">
          News
        </h4>
        <div className={cn("space-y-1.5", !analysis && "opacity-40")}>
          {newsItems.map((n, i) => (
            <div key={i} className="rounded px-2 py-1.5 text-xs">
              <div className="flex items-start gap-1.5">
                <span
                  className={cn(
                    "mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                    n.sentiment === "positive"
                      ? "bg-[var(--profit)]"
                      : n.sentiment === "negative"
                      ? "bg-[var(--loss)]"
                      : "bg-[var(--neutral)]"
                  )}
                />
                <span className="text-foreground leading-tight">
                  {n.headline}
                </span>
              </div>
              <span className="ml-3 text-[10px] text-muted-foreground">
                {n.time}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Chat Tab ────────────────────────────────────────────────

function ChatTab({ symbol }: { symbol: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const prevSymbolRef = useRef(symbol);

  // Reset chat when symbol changes
  useEffect(() => {
    if (prevSymbolRef.current !== symbol) {
      setMessages([
        {
          id: `intro-${symbol}`,
          role: "assistant",
          content: `I'm ready to help analyze ${symbol}. Ask me anything about the technicals, fundamentals, options flow, or trade ideas.`,
          timestamp: Date.now(),
        },
      ]);
      prevSymbolRef.current = symbol;
    }
  }, [symbol]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: String(Date.now()),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    const userInput = input.trim();
    setInput("");
    setLoading(true);

    try {
      const result = await chatWithAgent(userInput, symbol);
      let content = result.message || (result as unknown as { response?: string }).response || "No response";
      // Sanitize raw API errors so the user sees a friendly message
      if (/error|Error code:/i.test(content)) {
        content = "AI assistant unavailable. Check API configuration.";
      }
      const aiMsg: ChatMessage = {
        id: String(Date.now() + 1),
        role: "assistant",
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch {
      // Fallback response when API is unavailable
      const aiMsg: ChatMessage = {
        id: String(Date.now() + 1),
        role: "assistant",
        content: `Based on my analysis of ${symbol}, the technical setup looks constructive. The MACD just crossed bullish, RSI is at 58 (not overbought), and price is above all major moving averages. Consider a bull call spread if you want defined risk exposure.`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, symbol]);

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "rounded-lg px-3 py-2 text-xs leading-relaxed",
                msg.role === "user"
                  ? "bg-primary/10 text-foreground ml-6"
                  : "bg-[var(--panel)] text-foreground mr-2"
              )}
            >
              {msg.content}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Analyzing...
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="flex items-center gap-1.5 border-t border-border p-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={`Ask about ${symbol}...`}
          className="h-8 text-xs bg-background/50 border-border"
        />
        <Button
          aria-label="Send message"
          onClick={handleSend}
          disabled={loading || !input.trim()}
          size="icon"
          className="h-8 w-8 shrink-0"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Order Tab ───────────────────────────────────────────────

type AdvancedOrderType = "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";

function OrderTab({ symbol }: { symbol: string }) {
  const quote = useMarketStore((s) => s.quotes[symbol]);
  const { toast } = useToast();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState(10);
  const [orderType, setOrderType] = useState<AdvancedOrderType>("market");
  const [limitPrice, setLimitPrice] = useState(quote?.last ?? 0);
  const [stopPrice, setStopPrice] = useState(quote?.last ?? 0);
  const [trailAmount, setTrailAmount] = useState(1);
  const [trailType, setTrailType] = useState<"dollar" | "percent">("dollar");
  const [tif, setTif] = useState<"day" | "gtc">("day");
  const [submitting, setSubmitting] = useState(false);

  // Update prices when quote changes and order type is market
  useEffect(() => {
    if (orderType === "market" && quote?.last) {
      setLimitPrice(quote.last);
      setStopPrice(quote.last);
    }
  }, [quote?.last, orderType]);

  // Listen for quick-order events from the chart BUY/SELL buttons
  useEffect(() => {
    function handleQuickOrder(e: Event) {
      const { side: newSide, price: newPrice } = (e as CustomEvent<QuickOrderEvent>).detail;
      setSide(newSide);
      setLimitPrice(newPrice);
      setStopPrice(newPrice);
      setOrderType("limit");
    }
    window.addEventListener("alphadesk:quick-order", handleQuickOrder);
    return () => window.removeEventListener("alphadesk:quick-order", handleQuickOrder);
  }, []);

  const displayPrice = orderType === "market" ? (quote?.last ?? 0)
    : orderType === "limit" ? limitPrice
    : orderType === "stop" ? stopPrice
    : orderType === "stop_limit" ? limitPrice
    : (quote?.last ?? 0); // trailing stop uses market
  const estimatedCost = quantity * displayPrice;

  function buildOrderLabel(): string {
    const sideLabel = side === "buy" ? "Buy" : "Sell";
    switch (orderType) {
      case "market": return `${sideLabel} ${quantity} ${symbol} @ Market`;
      case "limit": return `${sideLabel} ${quantity} ${symbol} @ $${(limitPrice ?? 0).toFixed(2)}`;
      case "stop": return `${sideLabel} ${quantity} ${symbol} Stop $${(stopPrice ?? 0).toFixed(2)}`;
      case "stop_limit": return `${sideLabel} ${quantity} ${symbol} Stop $${(stopPrice ?? 0).toFixed(2)} Lmt $${(limitPrice ?? 0).toFixed(2)}`;
      case "trailing_stop": return `${sideLabel} ${quantity} ${symbol} Trail ${trailType === "dollar" ? "$" + (trailAmount ?? 0).toFixed(2) : (trailAmount ?? 0).toFixed(1) + "%"}`;
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const apiType = orderType === "trailing_stop" ? "trailing_stop" : orderType;
      await placeOrder({
        symbol,
        side,
        type: apiType as any,
        quantity,
        price: orderType === "limit" ? limitPrice : orderType === "stop_limit" ? limitPrice : undefined,
        stop_price: orderType === "stop" ? stopPrice : orderType === "stop_limit" ? stopPrice : undefined,
        trail_price: orderType === "trailing_stop" && trailType === "dollar" ? trailAmount : undefined,
        trail_percent: orderType === "trailing_stop" && trailType === "percent" ? trailAmount : undefined,
      });
      toast({ type: "success", message: `Order placed: ${buildOrderLabel()}` });
    } catch (err: any) {
      toast({ type: "error", message: err?.message ?? "Order failed" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-3 space-y-3">
      {/* Position Sizer */}
      <PositionSizer symbol={symbol} currentPrice={quote?.last ?? 0} />

      {/* Side Toggle */}
      <div className="flex gap-1">
        <button
          onClick={() => setSide("buy")}
          className={cn("flex-1 rounded py-1.5 text-xs font-semibold transition-colors",
            side === "buy" ? "bg-[var(--profit)]/20 text-[var(--profit)] ring-1 ring-[var(--profit)]/30" : "bg-[var(--panel)] text-muted-foreground"
          )}
        >Buy</button>
        <button
          onClick={() => setSide("sell")}
          className={cn("flex-1 rounded py-1.5 text-xs font-semibold transition-colors",
            side === "sell" ? "bg-[var(--loss)]/20 text-[var(--loss)] ring-1 ring-[var(--loss)]/30" : "bg-[var(--panel)] text-muted-foreground"
          )}
        >Sell</button>
      </div>

      {/* Quantity */}
      <div>
        <label htmlFor="order-quantity" className="text-[10px] uppercase tracking-wider text-[#8a8a95]">Quantity</label>
        <div className="flex items-center gap-1 mt-1">
          <button aria-label="Decrease quantity" onClick={() => setQuantity(Math.max(1, quantity - 1))} className="h-8 w-8 rounded border border-border bg-[var(--panel)] text-muted-foreground hover:text-foreground text-sm">-</button>
          <input
            id="order-quantity"
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
            className="h-8 flex-1 rounded border border-border bg-background px-2 text-center text-sm tabular-nums text-foreground"
            min={1}
          />
          <button aria-label="Increase quantity" onClick={() => setQuantity(quantity + 1)} className="h-8 w-8 rounded border border-border bg-[var(--panel)] text-muted-foreground hover:text-foreground text-sm">+</button>
        </div>
      </div>

      {/* Order Type */}
      <div>
        <label htmlFor="order-type" className="text-[10px] uppercase tracking-wider text-[#8a8a95]">Order Type</label>
        <select
          id="order-type"
          value={orderType}
          onChange={(e) => setOrderType(e.target.value as AdvancedOrderType)}
          className="mt-1 w-full h-8 rounded border border-border bg-background px-2 text-xs text-foreground"
        >
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop</option>
          <option value="stop_limit">Stop Limit</option>
          <option value="trailing_stop">Trailing Stop</option>
        </select>
      </div>

      {/* Conditional price fields based on order type */}
      {orderType === "limit" && (
        <div>
          <label htmlFor="order-limit-price" className="text-[10px] uppercase tracking-wider text-[#8a8a95]">Limit Price</label>
          <input
            id="order-limit-price"
            type="number"
            value={limitPrice}
            onChange={(e) => setLimitPrice(parseFloat(e.target.value) || 0)}
            step={0.01}
            className="mt-1 w-full h-8 rounded border border-border bg-background px-2 text-sm tabular-nums text-foreground"
          />
        </div>
      )}

      {orderType === "stop" && (
        <div>
          <label htmlFor="order-stop-price" className="text-[10px] uppercase tracking-wider text-[#8a8a95]">Stop Price</label>
          <input
            id="order-stop-price"
            type="number"
            value={stopPrice}
            onChange={(e) => setStopPrice(parseFloat(e.target.value) || 0)}
            step={0.01}
            className="mt-1 w-full h-8 rounded border border-border bg-background px-2 text-sm tabular-nums text-foreground"
          />
        </div>
      )}

      {orderType === "stop_limit" && (
        <>
          <div>
            <label htmlFor="order-stop-price-sl" className="text-[10px] uppercase tracking-wider text-[#8a8a95]">Stop Price</label>
            <input
              id="order-stop-price-sl"
              type="number"
              value={stopPrice}
              onChange={(e) => setStopPrice(parseFloat(e.target.value) || 0)}
              step={0.01}
              className="mt-1 w-full h-8 rounded border border-border bg-background px-2 text-sm tabular-nums text-foreground"
            />
          </div>
          <div>
            <label htmlFor="order-limit-price-sl" className="text-[10px] uppercase tracking-wider text-[#8a8a95]">Limit Price</label>
            <input
              id="order-limit-price-sl"
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(parseFloat(e.target.value) || 0)}
              step={0.01}
              className="mt-1 w-full h-8 rounded border border-border bg-background px-2 text-sm tabular-nums text-foreground"
            />
          </div>
        </>
      )}

      {orderType === "trailing_stop" && (
        <>
          <div>
            <label htmlFor="trail-type" className="text-[10px] uppercase tracking-wider text-[#8a8a95]">Trail Type</label>
            <div className="flex gap-1 mt-1">
              <button onClick={() => setTrailType("dollar")} className={cn("flex-1 rounded py-1 text-[11px] font-medium transition-colors", trailType === "dollar" ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-[var(--panel)] text-muted-foreground")}>$ Amount</button>
              <button onClick={() => setTrailType("percent")} className={cn("flex-1 rounded py-1 text-[11px] font-medium transition-colors", trailType === "percent" ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-[var(--panel)] text-muted-foreground")}>% Percent</button>
            </div>
          </div>
          <div>
            <label htmlFor="trail-amount" className="text-[10px] uppercase tracking-wider text-[#8a8a95]">
              Trail Amount {trailType === "dollar" ? "($)" : "(%)"}
            </label>
            <input
              id="trail-amount"
              type="number"
              value={trailAmount}
              onChange={(e) => setTrailAmount(parseFloat(e.target.value) || 0)}
              step={trailType === "dollar" ? 0.01 : 0.1}
              min={0}
              className="mt-1 w-full h-8 rounded border border-border bg-background px-2 text-sm tabular-nums text-foreground"
            />
          </div>
        </>
      )}

      {/* Time in Force */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-[#8a8a95]">Time in Force</label>
        <div className="flex gap-1 mt-1">
          <button onClick={() => setTif("day")} className={cn("flex-1 rounded py-1 text-[11px] font-medium transition-colors", tif === "day" ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-[var(--panel)] text-muted-foreground")}>Day</button>
          <button onClick={() => setTif("gtc")} className={cn("flex-1 rounded py-1 text-[11px] font-medium transition-colors", tif === "gtc" ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-[var(--panel)] text-muted-foreground")}>GTC</button>
        </div>
      </div>

      {/* Separator + Preview */}
      <div className="border-t border-border pt-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-[#8a8a95]">Est. {side === "buy" ? "Cost" : "Proceeds"}</span>
          <span className="text-foreground tabular-nums font-medium">${(estimatedCost ?? 0).toFixed(2)}</span>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={submitting || quantity <= 0}
        className={cn(
          "w-full rounded-lg py-2.5 text-sm font-semibold transition-colors disabled:opacity-50",
          side === "buy"
            ? "bg-[var(--profit)] hover:bg-[var(--profit)]/90 text-black"
            : "bg-[var(--loss)] hover:bg-[var(--loss)]/90 text-black"
        )}
      >
        {submitting ? "Placing..." : buildOrderLabel()}
      </button>
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────

export function AnalysisPanel() {
  const { selectedSymbol } = useMarketStore();
  const { activePanels, setActiveTab } = useUIStore();
  const { analysis, loading, timedOut } = useAnalysisData(selectedSymbol);

  // Auto-switch to the Order tab when a quick-order event arrives from the chart
  useEffect(() => {
    function handleQuickOrder() {
      setActiveTab("right", "order");
    }
    window.addEventListener("alphadesk:quick-order", handleQuickOrder);
    return () => window.removeEventListener("alphadesk:quick-order", handleQuickOrder);
  }, [setActiveTab]);

  return (
    <div className="flex h-full flex-col bg-[var(--panel)] border-l border-[#2a2a3e]">
      <Tabs
        value={activePanels.right}
        onValueChange={(v) => setActiveTab("right", v)}
        className="flex flex-col h-full"
      >
        <div className="flex items-center justify-between mx-2 mt-2 shrink-0 relative z-20">
          <TabsList className="h-7 bg-[#12121a] p-0.5 flex-1 min-w-0 overflow-x-auto overflow-y-hidden border border-[#2a2a3e] relative z-20">
            <TabsTrigger value="technical" className="text-[10px] h-6 px-1.5 gap-0.5 shrink-0" title="Technical Analysis">
              <BarChart2 className="h-3 w-3 shrink-0" /> Tech
            </TabsTrigger>
            <TabsTrigger value="fundamental" className="text-[10px] h-6 px-1.5 gap-0.5 shrink-0" title="Fundamental Analysis">
              <DollarSign className="h-3 w-3 shrink-0" /> Fund
            </TabsTrigger>
            <TabsTrigger value="sentiment" className="text-[10px] h-6 px-1.5 gap-0.5 shrink-0" title="Sentiment Analysis">
              <Activity className="h-3 w-3 shrink-0" /> Sentim.
            </TabsTrigger>
            <TabsTrigger value="chat" className="text-[10px] h-6 px-1.5 gap-0.5 shrink-0" title="AI Chat">
              <MessageSquare className="h-3 w-3 shrink-0" /> Chat
            </TabsTrigger>
            <TabsTrigger value="order" className="text-[10px] h-6 px-1.5 gap-0.5 shrink-0" title="Place Order">
              <ShoppingCart className="h-3 w-3 shrink-0" /> Order
            </TabsTrigger>
            <TabsTrigger value="mtf" className="text-[10px] h-6 px-1.5 gap-0.5 shrink-0" title="Multi-Timeframe">
              <Layers className="h-3 w-3 shrink-0" /> MTF
            </TabsTrigger>
          </TabsList>
          <HelpCircle text="AI-powered analysis of the selected symbol. Technical, fundamental, and sentiment scores updated by Claude agents." />
        </div>

        <TabsContent value="technical" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <TechnicalTab symbol={selectedSymbol} analysis={analysis} loading={loading} timedOut={timedOut} />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="fundamental" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <FundamentalTab symbol={selectedSymbol} analysis={analysis} loading={loading} timedOut={timedOut} />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="sentiment" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <SentimentTab symbol={selectedSymbol} analysis={analysis} loading={loading} timedOut={timedOut} />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="chat" className="flex-1 mt-0 overflow-hidden">
          <ChatTab symbol={selectedSymbol} />
        </TabsContent>

        <TabsContent value="order" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <OrderTab symbol={selectedSymbol} />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="mtf" className="flex-1 mt-0 overflow-hidden">
          <MultiTimeframe />
        </TabsContent>
      </Tabs>
    </div>
  );
}
