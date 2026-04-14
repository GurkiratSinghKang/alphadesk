"use client";

import { useState, useRef, useCallback } from "react";
import { Share2, Copy, Download, Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMarketStore } from "@/stores/market";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";
import type { Analysis } from "@/types";

// ─── Share Card Data ────────────────────────────────────────

interface ShareCardData {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  volume: number;
  technicalScore: number | null;
  rsi: string | null;
  support: number | null;
  resistance: number | null;
  summary: string | null;
  pnl: number | null;
  pnlPct: number | null;
}

// ─── Helpers ────────────────────────────────────────────────

function deriveKeyLevels(price: number) {
  const step = price * 0.03;
  return {
    support: Math.round((price - step) * 100) / 100,
    resistance: Math.round((price + step) * 100) / 100,
  };
}

function formatVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toString();
}

function buildTextSummary(data: ShareCardData): string {
  const changeSign = data.change >= 0 ? "+" : "";
  const lines = [
    `${data.symbol} ${formatCurrency(data.price)} (${changeSign}${formatPercent(data.changePct)})`,
    `Technical Score: ${data.technicalScore ?? "N/A"} | RSI: ${data.rsi ?? "N/A"}`,
    `Support: ${data.support ? formatCurrency(data.support) : "N/A"} | Resistance: ${data.resistance ? formatCurrency(data.resistance) : "N/A"}`,
  ];
  if (data.pnl != null) {
    const pnlSign = data.pnl >= 0 ? "+" : "";
    lines.push(
      `P&L: ${pnlSign}${formatCurrency(data.pnl)}${data.pnlPct != null ? ` (${pnlSign}${data.pnlPct.toFixed(2)}%)` : ""}`
    );
  }
  if (data.summary) {
    lines.push(`AI: ${data.summary.slice(0, 120)}${data.summary.length > 120 ? "..." : ""}`);
  }
  lines.push("Via AlphaDesk — tradingalpha.net");
  return lines.join("\n");
}

// ─── Share Card Component ───────────────────────────────────

function ShareCard({ data }: { data: ShareCardData }) {
  const isPositive = data.change >= 0;
  const changeSign = isPositive ? "+" : "";

  return (
    <div
      className="w-[420px] rounded-xl border border-[#2a2a3e] bg-gradient-to-br from-[#0e0e18] to-[#12121f] p-5 shadow-2xl"
      data-share-card
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary font-bold text-sm">
            {data.symbol.slice(0, 2)}
          </div>
          <div>
            <div className="text-base font-bold text-foreground">{data.symbol}</div>
            <div className="text-[11px] text-muted-foreground">
              Vol: {formatVolume(data.volume)} | H: {data.high.toFixed(2)} L: {data.low.toFixed(2)}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-foreground tabular-nums">
            {formatCurrency(data.price)}
          </div>
          <div className={cn(
            "text-xs font-medium tabular-nums",
            isPositive ? "text-[var(--profit)]" : "text-[var(--loss)]"
          )}>
            {changeSign}{data.change.toFixed(2)} ({changeSign}{formatPercent(data.changePct)})
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
          <div className="text-[10px] text-muted-foreground mb-0.5">Technical</div>
          <div className={cn(
            "text-sm font-bold tabular-nums",
            (data.technicalScore ?? 50) >= 60 ? "text-[var(--profit)]"
              : (data.technicalScore ?? 50) < 40 ? "text-[var(--loss)]"
              : "text-[var(--chart-4)]"
          )}>
            {data.technicalScore ?? "--"}/100
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
          <div className="text-[10px] text-muted-foreground mb-0.5">RSI (14)</div>
          <div className="text-sm font-bold text-foreground tabular-nums">{data.rsi ?? "--"}</div>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
          <div className="text-[10px] text-muted-foreground mb-0.5">Volume</div>
          <div className="text-sm font-bold text-foreground tabular-nums">{formatVolume(data.volume)}</div>
        </div>
      </div>

      {/* Key Levels */}
      <div className="flex items-center gap-4 mb-4 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--profit)]" />
          <span className="text-muted-foreground">Support:</span>
          <span className="font-medium text-[var(--profit)] tabular-nums">
            {data.support ? formatCurrency(data.support) : "N/A"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--loss)]" />
          <span className="text-muted-foreground">Resistance:</span>
          <span className="font-medium text-[var(--loss)] tabular-nums">
            {data.resistance ? formatCurrency(data.resistance) : "N/A"}
          </span>
        </div>
      </div>

      {/* P&L if user has a position */}
      {data.pnl != null && (
        <div className={cn(
          "rounded-lg px-3 py-2 mb-4 border",
          data.pnl >= 0
            ? "bg-[var(--profit)]/5 border-[var(--profit)]/20"
            : "bg-[var(--loss)]/5 border-[var(--loss)]/20"
        )}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Unrealized P&L</span>
            <span className={cn(
              "text-sm font-bold tabular-nums",
              data.pnl >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]"
            )}>
              {data.pnl >= 0 ? "+" : ""}{formatCurrency(data.pnl)}
              {data.pnlPct != null && (
                <span className="ml-1 text-[10px]">
                  ({data.pnl >= 0 ? "+" : ""}{data.pnlPct.toFixed(2)}%)
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* AI Summary */}
      {data.summary && (
        <div className="rounded-lg bg-primary/5 border border-primary/10 px-3 py-2 mb-4">
          <div className="text-[10px] text-primary/70 mb-1 font-medium">AI Analysis</div>
          <p className="text-[11px] text-foreground/80 leading-relaxed line-clamp-3">
            {data.summary}
          </p>
        </div>
      )}

      {/* Footer watermark */}
      <div className="flex items-center justify-between border-t border-[#2a2a3e] pt-3 mt-1">
        <div className="flex items-center gap-1.5">
          <div className="h-4 w-4 rounded bg-primary/20 flex items-center justify-center">
            <span className="text-[8px] font-bold text-primary">A</span>
          </div>
          <span className="text-[10px] font-medium text-muted-foreground">AlphaDesk</span>
        </div>
        <span className="text-[9px] text-muted-foreground/60">tradingalpha.net</span>
      </div>
    </div>
  );
}

// ─── Share Trade Modal ──────────────────────────────────────

interface ShareTradeProps {
  symbol?: string;
  analysis?: Analysis | null;
  pnl?: number | null;
  pnlPct?: number | null;
}

export function ShareTradeButton({ symbol: symbolProp, analysis, pnl, pnlPct }: ShareTradeProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const globalSymbol = useMarketStore((s) => s.selectedSymbol);
  const selectedSymbol = symbolProp ?? globalSymbol;
  const quote = useMarketStore((s) => s.quotes[selectedSymbol]);

  const price = quote?.last ?? quote?.close ?? 0;
  const change = quote?.change ?? 0;
  const changePct = quote?.changePct ?? 0;
  const techScore = analysis?.technicalScore ?? null;
  const rsi = techScore != null ? (40 + techScore * 0.3).toFixed(1) : null;
  const levels = price > 0 ? deriveKeyLevels(price) : { support: null, resistance: null };

  const cardData: ShareCardData = {
    symbol: selectedSymbol,
    price,
    change,
    changePct,
    high: quote?.high ?? price,
    low: quote?.low ?? price,
    volume: quote?.volume ?? 0,
    technicalScore: techScore,
    rsi,
    support: levels.support,
    resistance: levels.resistance,
    summary: analysis?.summary ?? null,
    pnl: pnl ?? null,
    pnlPct: pnlPct ?? null,
  };

  const handleCopyText = useCallback(async () => {
    const text = buildTextSummary(cardData);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: use textarea method
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [cardData]);

  const handleDownloadPng = useCallback(async () => {
    const card = cardRef.current;
    if (!card) return;
    setDownloading(true);

    try {
      // Use canvas-based rendering for PNG export
      const canvas = document.createElement("canvas");
      const scale = 2; // Retina
      const width = 420;
      const height = card.offsetHeight;
      canvas.width = width * scale;
      canvas.height = height * scale;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.scale(scale, scale);

      // Dark background
      ctx.fillStyle = "#0e0e18";
      ctx.fillRect(0, 0, width, height);

      // Border
      ctx.strokeStyle = "#2a2a3e";
      ctx.lineWidth = 1;
      ctx.roundRect(0, 0, width, height, 12);
      ctx.stroke();

      // Symbol
      ctx.fillStyle = "#3b82f6";
      ctx.font = "bold 14px Inter, system-ui, sans-serif";
      ctx.fillText(cardData.symbol, 60, 32);

      // Price
      ctx.fillStyle = "#e2e2ea";
      ctx.font = "bold 20px Inter, system-ui, sans-serif";
      const priceStr = formatCurrency(cardData.price);
      const priceWidth = ctx.measureText(priceStr).width;
      ctx.fillText(priceStr, width - 20 - priceWidth, 30);

      // Change
      const changeSign = cardData.change >= 0 ? "+" : "";
      const changeColor = cardData.change >= 0 ? "#22c55e" : "#ef4444";
      ctx.fillStyle = changeColor;
      ctx.font = "500 11px Inter, system-ui, sans-serif";
      const changeStr = `${changeSign}${cardData.change.toFixed(2)} (${changeSign}${formatPercent(cardData.changePct)})`;
      const changeWidth = ctx.measureText(changeStr).width;
      ctx.fillText(changeStr, width - 20 - changeWidth, 48);

      // Volume info
      ctx.fillStyle = "#71717a";
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.fillText(`Vol: ${formatVolume(cardData.volume)} | H: ${cardData.high.toFixed(2)} L: ${cardData.low.toFixed(2)}`, 60, 48);

      // Metrics
      const metricsY = 75;
      const metricW = (width - 50) / 3;

      // Technical Score
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(20, metricsY, metricW, 45);
      ctx.fillStyle = "#71717a";
      ctx.font = "10px Inter, system-ui, sans-serif";
      ctx.fillText("Technical", 28, metricsY + 15);
      ctx.fillStyle = (cardData.technicalScore ?? 50) >= 60 ? "#22c55e"
        : (cardData.technicalScore ?? 50) < 40 ? "#ef4444" : "#eab308";
      ctx.font = "bold 13px Inter, system-ui, sans-serif";
      ctx.fillText(`${cardData.technicalScore ?? "--"}/100`, 28, metricsY + 35);

      // RSI
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(20 + metricW + 5, metricsY, metricW, 45);
      ctx.fillStyle = "#71717a";
      ctx.font = "10px Inter, system-ui, sans-serif";
      ctx.fillText("RSI (14)", 28 + metricW + 5, metricsY + 15);
      ctx.fillStyle = "#e2e2ea";
      ctx.font = "bold 13px Inter, system-ui, sans-serif";
      ctx.fillText(cardData.rsi ?? "--", 28 + metricW + 5, metricsY + 35);

      // Volume metric
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(20 + (metricW + 5) * 2, metricsY, metricW, 45);
      ctx.fillStyle = "#71717a";
      ctx.font = "10px Inter, system-ui, sans-serif";
      ctx.fillText("Volume", 28 + (metricW + 5) * 2, metricsY + 15);
      ctx.fillStyle = "#e2e2ea";
      ctx.font = "bold 13px Inter, system-ui, sans-serif";
      ctx.fillText(formatVolume(cardData.volume), 28 + (metricW + 5) * 2, metricsY + 35);

      // Key Levels
      let yOffset = metricsY + 65;
      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.arc(28, yOffset, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#71717a";
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.fillText("Support:", 36, yOffset + 4);
      ctx.fillStyle = "#22c55e";
      ctx.font = "500 11px Inter, system-ui, sans-serif";
      ctx.fillText(cardData.support ? formatCurrency(cardData.support) : "N/A", 88, yOffset + 4);

      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(width / 2 + 10, yOffset, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#71717a";
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.fillText("Resistance:", width / 2 + 18, yOffset + 4);
      ctx.fillStyle = "#ef4444";
      ctx.font = "500 11px Inter, system-ui, sans-serif";
      ctx.fillText(cardData.resistance ? formatCurrency(cardData.resistance) : "N/A", width / 2 + 82, yOffset + 4);

      yOffset += 25;

      // P&L
      if (cardData.pnl != null) {
        const pnlColor = cardData.pnl >= 0 ? "#22c55e" : "#ef4444";
        ctx.fillStyle = pnlColor + "0d";
        ctx.fillRect(20, yOffset, width - 40, 32);
        ctx.fillStyle = "#71717a";
        ctx.font = "10px Inter, system-ui, sans-serif";
        ctx.fillText("Unrealized P&L", 28, yOffset + 14);
        ctx.fillStyle = pnlColor;
        ctx.font = "bold 12px Inter, system-ui, sans-serif";
        const pnlStr = `${cardData.pnl >= 0 ? "+" : ""}${formatCurrency(cardData.pnl)}`;
        const pnlW = ctx.measureText(pnlStr).width;
        ctx.fillText(pnlStr, width - 28 - pnlW, yOffset + 22);
        yOffset += 42;
      }

      // AI Summary
      if (cardData.summary) {
        ctx.fillStyle = "rgba(59,130,246,0.05)";
        ctx.fillRect(20, yOffset, width - 40, 50);
        ctx.fillStyle = "rgba(59,130,246,0.7)";
        ctx.font = "500 10px Inter, system-ui, sans-serif";
        ctx.fillText("AI Analysis", 28, yOffset + 14);
        ctx.fillStyle = "rgba(226,226,234,0.8)";
        ctx.font = "11px Inter, system-ui, sans-serif";
        const summaryTruncated = cardData.summary.length > 100 ? cardData.summary.slice(0, 100) + "..." : cardData.summary;
        ctx.fillText(summaryTruncated, 28, yOffset + 32);
        yOffset += 60;
      }

      // Footer
      ctx.fillStyle = "#2a2a3e";
      ctx.fillRect(20, yOffset, width - 40, 1);
      yOffset += 15;
      ctx.fillStyle = "#3b82f6";
      ctx.font = "bold 8px Inter, system-ui, sans-serif";
      ctx.fillText("A", 28, yOffset + 4);
      ctx.fillStyle = "#71717a";
      ctx.font = "500 10px Inter, system-ui, sans-serif";
      ctx.fillText("AlphaDesk", 40, yOffset + 4);
      ctx.fillStyle = "rgba(113,113,122,0.6)";
      ctx.font = "9px Inter, system-ui, sans-serif";
      const urlStr = "tradingalpha.net";
      const urlWidth = ctx.measureText(urlStr).width;
      ctx.fillText(urlStr, width - 20 - urlWidth, yOffset + 4);

      // Export
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${cardData.symbol}-trade-idea.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch {
      // Fallback: copy text
      handleCopyText();
    } finally {
      setDownloading(false);
    }
  }, [cardData, handleCopyText]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/50"
        title="Share trade idea"
        aria-label="Share trade idea"
      >
        <Share2 className="h-3.5 w-3.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[480px] bg-[var(--surface)] border-[#2a2a3e] p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-0">
            <DialogTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Share2 className="h-4 w-4 text-primary" />
              Share Trade Idea
            </DialogTitle>
            <DialogDescription className="text-[11px] text-muted-foreground">
              Share your {selectedSymbol} analysis as a card or text summary.
            </DialogDescription>
          </DialogHeader>

          {/* Card Preview */}
          <div className="px-5 py-4 flex justify-center" ref={cardRef}>
            <ShareCard data={cardData} />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 border-t border-[#2a2a3e] px-5 py-3 bg-[#0a0a0f]">
            <Button
              onClick={handleCopyText}
              variant="outline"
              className="flex-1 h-8 text-xs gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[var(--profit)]" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy to Clipboard
                </>
              )}
            </Button>
            <Button
              onClick={handleDownloadPng}
              variant="outline"
              className="flex-1 h-8 text-xs gap-1.5"
              disabled={downloading}
            >
              <Download className="h-3.5 w-3.5" />
              {downloading ? "Exporting..." : "Download PNG"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
