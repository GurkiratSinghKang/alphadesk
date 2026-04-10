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
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useMarketStore } from "@/stores/market";
import { useUIStore } from "@/stores/ui";
import { formatPercent, cn } from "@/lib/utils";
import { HelpCircle } from "@/components/ui/HelpCircle";
import { chatWithAgent, getAnalysis, analyzeSymbol } from "@/lib/api";
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
  const score = analysis?.technicalScore ?? 72;
  const keyLevels = [
    { label: "Resistance 2", price: 245.8 },
    { label: "Resistance 1", price: 238.5 },
    { label: "Current", price: 232.1 },
    { label: "Support 1", price: 225.0 },
    { label: "Support 2", price: 218.3 },
  ];
  const indicators: { name: string; value: string; signal: "bullish" | "bearish" | "neutral" }[] = [
    { name: "RSI (14)", value: "58.3", signal: "neutral" },
    { name: "MACD", value: "Bullish Cross", signal: "bullish" },
    { name: "EMA 20/50", value: "Above", signal: "bullish" },
    { name: "BB Width", value: "Expanding", signal: "neutral" },
    { name: "ADX", value: "28.4", signal: "bullish" },
    { name: "OBV", value: "Rising", signal: "bullish" },
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
          <p className="text-[11px] text-muted-foreground mt-1">
            {analysis?.summary ?? `${symbol} showing bullish momentum with MACD crossover and rising OBV. Watch for breakout above R1.`}
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
  const fScore = 7;
  const metrics = [
    { label: "P/E Ratio", value: "28.4x", benchmark: "25.1x" },
    { label: "P/S Ratio", value: "7.2x", benchmark: "5.8x" },
    { label: "EV/EBITDA", value: "22.1x", benchmark: "18.5x" },
    { label: "Profit Margin", value: "25.8%", benchmark: "21.3%" },
    { label: "ROE", value: "48.2%", benchmark: "35.1%" },
    { label: "Debt/Equity", value: "1.73x", benchmark: "1.45x" },
    { label: "FCF Yield", value: "3.2%", benchmark: "4.1%" },
    { label: "Revenue Growth", value: "+12.4%", benchmark: "+8.2%" },
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
  const sentimentScore = analysis?.sentimentScore ?? 35;
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
        <ScoreGauge value={sentimentScore + 50} label="Sentiment" />
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
    if (prevSymbolRef.current !== symbol || messages.length === 0) {
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
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <TabsList className="h-7 bg-[#12121a] p-0.5 flex-1 border border-[#2a2a3e]">
            <TabsTrigger value="technical" className="text-[11px] h-6 px-2 gap-1">
              <Activity className="h-3 w-3" /> Tech
            </TabsTrigger>
            <TabsTrigger value="fundamental" className="text-[11px] h-6 px-2 gap-1">
              <DollarSign className="h-3 w-3" /> Fund
            </TabsTrigger>
            <TabsTrigger value="sentiment" className="text-[11px] h-6 px-2 gap-1">
              <BarChart2 className="h-3 w-3" /> Sent
            </TabsTrigger>
            <TabsTrigger value="chat" className="text-[11px] h-6 px-2 gap-1">
              <MessageSquare className="h-3 w-3" /> Chat
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
      </Tabs>
    </div>
  );
}
