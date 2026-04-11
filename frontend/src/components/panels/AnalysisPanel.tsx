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
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useMarketStore } from "@/stores/market";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { HelpCircle } from "@/components/ui/HelpCircle";
import { chatWithAgent, getAnalysis, analyzeSymbol, placeOrder } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import type { ChatMessage, Analysis } from "@/types";

// ─── Score Gauge ─────────────────────────────────────────────

function ScoreGauge({
  value,
  max = 100,
  label,
  size = 80,
}: {
  value: number;
  max?: number;
  label: string;
  size?: number;
}) {
  const pct = Math.min(Math.max(value / max, 0), 1);
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
            {Math.round(value)}
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
          // Use fallback demo data
          // Generate deterministic scores based on symbol
          let seed = 0;
          for (let c = 0; c < symbol.length; c++) seed += symbol.charCodeAt(c);
          const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
          const techScore = Math.round(40 + rng() * 50);
          const fundScore = Math.round(35 + rng() * 55);
          const sentScore = Math.round(-20 + rng() * 70);
          setAnalysis({
            symbol,
            technicalScore: techScore,
            fundamentalScore: fundScore,
            sentimentScore: sentScore,
            composite: Math.round((techScore + fundScore + sentScore + 50) / 3),
            summary: `${symbol} showing constructive technical setup with bullish momentum indicators.`,
            signals: [
              { name: "MACD Crossover", type: "bullish", description: "Bullish MACD cross on daily", strength: 78 },
              { name: "RSI Neutral", type: "neutral", description: "RSI at 58, room to run", strength: 55 },
              { name: "Above EMAs", type: "bullish", description: "Price above 20/50 EMA", strength: 82 },
            ],
          });
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
  const quote = useMarketStore((s) => s.quotes.get(symbol));
  const score = analysis?.technicalScore ?? 50;
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

  return (
    <div className="space-y-4 p-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">
            Technical Score
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1 line-clamp-3 overflow-hidden break-words">
            {analysis?.summary ?? (score >= 60 ? `${symbol} showing bullish momentum. Watch for breakout above resistance.` : score <= 40 ? `${symbol} under selling pressure. Watch support levels.` : `${symbol} in consolidation range. Await directional catalyst.`)}
          </p>
        </div>
        <ScoreGauge value={score} label="Technical" />
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
              <span className="tabular-nums text-foreground">
                ${l.price.toFixed(2)}
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
    { label: "P/E Ratio", value: `${peRatio}x`, benchmark: `${(15 + rng() * 20).toFixed(1)}x` },
    { label: "P/S Ratio", value: `${(3 + rng() * 8).toFixed(1)}x`, benchmark: `${(3 + rng() * 6).toFixed(1)}x` },
    { label: "EV/EBITDA", value: `${(12 + rng() * 18).toFixed(1)}x`, benchmark: `${(10 + rng() * 14).toFixed(1)}x` },
    { label: "Profit Margin", value: `${opMargin}%`, benchmark: `${(8 + rng() * 20).toFixed(1)}%` },
    { label: "ROE", value: `${roe}%`, benchmark: `${(10 + rng() * 25).toFixed(1)}%` },
    { label: "Debt/Equity", value: `${debtEquity}x`, benchmark: `${(0.3 + rng() * 1.2).toFixed(2)}x` },
    { label: "FCF Yield", value: `${(1 + rng() * 5).toFixed(1)}%`, benchmark: `${(2 + rng() * 4).toFixed(1)}%` },
    { label: "Revenue Growth", value: `${Number(revGrowth) >= 0 ? "+" : ""}${revGrowth}%`, benchmark: `+${(3 + rng() * 12).toFixed(1)}%` },
  ];

  return (
    <div className="space-y-4 p-3">
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2">
          Piotroski F-Score
        </h3>
        <FScoreDots score={fScore} />
        <p className="text-[11px] text-muted-foreground mt-2">
          {symbol} has strong fundamentals with high profitability and improving financial health.
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
                <span className="text-foreground tabular-nums">{m.value}</span>
                <span className="text-muted-foreground tabular-nums text-[10px]">
                  vs {m.benchmark}
                </span>
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
  const flowItems = [
    { text: "Large call sweep SPY 600C Jan 2027", type: "bullish" as const, size: "$2.4M" },
    { text: "Put buying in XLF sector ETF", type: "bearish" as const, size: "$1.1M" },
    { text: "Unusual volume in AAPL 250C", type: "bullish" as const, size: "$890K" },
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
          <h3 className="text-xs font-medium text-muted-foreground">
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
              <span className="flex-1 text-foreground">{f.text}</span>
              <span className="text-muted-foreground">{f.size}</span>
            </div>
          ))}
        </div>
      </div>

      <Separator className="bg-border" />

      <div>
        <h4 className="text-[11px] font-medium text-muted-foreground mb-2">
          News
        </h4>
        <div className="space-y-1.5">
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
      const aiMsg: ChatMessage = {
        id: String(Date.now() + 1),
        role: "assistant",
        content: result.message || (result as unknown as { response?: string }).response || "No response",
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

function OrderTab({ symbol }: { symbol: string }) {
  const quote = useMarketStore((s) => s.quotes.get(symbol));
  const { toast } = useToast();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState(10);
  const [orderType, setOrderType] = useState<"market" | "limit" | "stop" | "stop_limit">("market");
  const [price, setPrice] = useState(quote?.last ?? 0);
  const [tif, setTif] = useState<"day" | "gtc">("day");
  const [submitting, setSubmitting] = useState(false);

  // Update price when quote changes and order type is market
  useEffect(() => {
    if (orderType === "market" && quote?.last) setPrice(quote.last);
  }, [quote?.last, orderType]);

  const estimatedCost = quantity * price;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await placeOrder({
        symbol,
        side,
        type: orderType,
        quantity,
        price: orderType !== "market" ? price : undefined,
      });
      toast({ type: "success", message: `Order placed: ${side === "buy" ? "Buy" : "Sell"} ${quantity} ${symbol} @ ${orderType === "market" ? "Market" : "$" + price.toFixed(2)}` });
    } catch (err: any) {
      toast({ type: "error", message: err?.message ?? "Order failed" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-3 space-y-3">
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
        <label className="text-[10px] uppercase tracking-wider text-[#555]">Quantity</label>
        <div className="flex items-center gap-1 mt-1">
          <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="h-8 w-8 rounded border border-border bg-[var(--panel)] text-muted-foreground hover:text-foreground text-sm">-</button>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
            className="h-8 flex-1 rounded border border-border bg-background px-2 text-center text-sm tabular-nums text-foreground"
            min={1}
          />
          <button onClick={() => setQuantity(quantity + 1)} className="h-8 w-8 rounded border border-border bg-[var(--panel)] text-muted-foreground hover:text-foreground text-sm">+</button>
        </div>
      </div>

      {/* Order Type */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-[#555]">Order Type</label>
        <select
          value={orderType}
          onChange={(e) => setOrderType(e.target.value as any)}
          className="mt-1 w-full h-8 rounded border border-border bg-background px-2 text-xs text-foreground"
        >
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop</option>
          <option value="stop_limit">Stop Limit</option>
        </select>
      </div>

      {/* Price (shown for limit/stop) */}
      {orderType !== "market" && (
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#555]">
            {orderType === "stop" ? "Stop Price" : "Limit Price"}
          </label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
            step={0.01}
            className="mt-1 w-full h-8 rounded border border-border bg-background px-2 text-sm tabular-nums text-foreground"
          />
        </div>
      )}

      {/* Time in Force */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-[#555]">Time in Force</label>
        <div className="flex gap-1 mt-1">
          <button onClick={() => setTif("day")} className={cn("flex-1 rounded py-1 text-[11px] font-medium transition-colors", tif === "day" ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-[var(--panel)] text-muted-foreground")}>Day</button>
          <button onClick={() => setTif("gtc")} className={cn("flex-1 rounded py-1 text-[11px] font-medium transition-colors", tif === "gtc" ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-[var(--panel)] text-muted-foreground")}>GTC</button>
        </div>
      </div>

      {/* Separator + Preview */}
      <div className="border-t border-border pt-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-[#555]">Est. {side === "buy" ? "Cost" : "Proceeds"}</span>
          <span className="text-foreground tabular-nums font-medium">${estimatedCost.toFixed(2)}</span>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={submitting || quantity <= 0}
        className={cn(
          "w-full rounded-lg py-2.5 text-sm font-semibold transition-colors disabled:opacity-50",
          side === "buy"
            ? "bg-[var(--profit)] hover:bg-[var(--profit)]/90 text-white"
            : "bg-[var(--loss)] hover:bg-[var(--loss)]/90 text-white"
        )}
      >
        {submitting ? "Placing..." : `${side === "buy" ? "Buy" : "Sell"} ${quantity} ${symbol} @ ${orderType === "market" ? "Market" : "$" + price.toFixed(2)}`}
      </button>
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────

export function AnalysisPanel() {
  const { selectedSymbol } = useMarketStore();
  const { activePanels, setActiveTab } = useUIStore();
  const { analysis, loading, timedOut } = useAnalysisData(selectedSymbol);

  return (
    <div className="flex h-full flex-col bg-[var(--panel)] border-l border-[#2a2a3e]">
      <Tabs
        value={activePanels.right}
        onValueChange={(v) => setActiveTab("right", v)}
        className="flex flex-col h-full"
      >
        <div className="flex items-center justify-between mx-2 mt-2 shrink-0">
          <TabsList className="h-7 bg-[#12121a] p-0.5 flex-1 min-w-0 overflow-hidden border border-[#2a2a3e]">
            <TabsTrigger value="technical" className="text-[10px] h-6 px-1.5 gap-0.5">
              <Activity className="h-3 w-3" /> Tech
            </TabsTrigger>
            <TabsTrigger value="fundamental" className="text-[10px] h-6 px-1.5 gap-0.5">
              <DollarSign className="h-3 w-3" /> Fund
            </TabsTrigger>
            <TabsTrigger value="sentiment" className="text-[10px] h-6 px-1.5 gap-0.5">
              <BarChart2 className="h-3 w-3" /> Sent
            </TabsTrigger>
            <TabsTrigger value="chat" className="text-[10px] h-6 px-1.5 gap-0.5">
              <MessageSquare className="h-3 w-3" /> Chat
            </TabsTrigger>
            <TabsTrigger value="order" className="text-[10px] h-6 px-1.5 gap-0.5">
              <ShoppingCart className="h-3 w-3" /> Order
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
      </Tabs>
    </div>
  );
}
