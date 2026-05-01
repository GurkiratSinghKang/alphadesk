"use client";

import { useState, useRef, useCallback } from "react";
import { Share2, Copy, Download, Check } from "lucide-react";
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

/**
 * Read a CSS variable off :root. Canvas `fillStyle` / `strokeStyle`
 * need concrete color strings — the browser does not resolve `var(--up-500)`
 * inside those properties. Fallback hex values match the tokens' literal
 * hex so the card still paints if the stylesheet hasn't applied yet.
 */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v ? v.trim() : fallback;
}

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
  /**
   * Real RSI(14) pulled from the backend's `AnalysisTechnicals.rsi_14`,
   * not a synthetic number derived from `technicalScore`. `null` means
   * "not available" and the card omits the field rather than showing a
   * fabricated value.
   */
  rsi: string | null;
  /**
   * Real support/resistance pivot levels from `AnalysisTechnicals`.
   * When the backend has not computed them yet, both are `null` and the
   * card hides the levels row (no more spot ± 3% placeholder).
   */
  support: number | null;
  resistance: number | null;
  summary: string | null;
  pnl: number | null;
  pnlPct: number | null;
}

// ─── Helpers ────────────────────────────────────────────────

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
  ];
  // Technical score is always real (backend-computed); RSI only when we
  // have a real reading — omit the line entirely otherwise so shared
  // text never contains synthesized indicators.
  if (data.technicalScore != null || data.rsi != null) {
    const parts: string[] = [];
    if (data.technicalScore != null) parts.push(`Technical Score: ${data.technicalScore}`);
    if (data.rsi != null) parts.push(`RSI: ${data.rsi}`);
    lines.push(parts.join(" | "));
  }
  // Only emit pivot-levels line when the backend supplied at least one
  // real level; no more "Support: N/A | Resistance: N/A" noise.
  if (data.support != null || data.resistance != null) {
    const parts: string[] = [];
    if (data.support != null) parts.push(`Support: ${formatCurrency(data.support)}`);
    if (data.resistance != null) parts.push(`Resistance: ${formatCurrency(data.resistance)}`);
    lines.push(parts.join(" | "));
  }
  // Today's H/L range — always available from the live quote, anchors
  // the share card with one objective piece of intraday context.
  if (Number.isFinite(data.low) && Number.isFinite(data.high) && data.high > 0) {
    lines.push(`Range: ${(data.low ?? 0).toFixed(2)}–${(data.high ?? 0).toFixed(2)} | Vol: ${formatVolume(data.volume)}`);
  }
  if (data.pnl != null) {
    const pnlSign = data.pnl >= 0 ? "+" : "";
    lines.push(
      `P&L: ${pnlSign}${formatCurrency(data.pnl)}${data.pnlPct != null ? ` (${pnlSign}${(data.pnlPct ?? 0).toFixed(2)}%)` : ""}`
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
      className="w-[420px] rounded-xl border border-border bg-gradient-to-br from-[var(--bg)] to-[var(--bg-elev-2)] p-5 shadow-2xl"
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
            <div className="text-[12px] text-muted-foreground">
              Vol: {formatVolume(data.volume)} | H: {(data.high ?? 0).toFixed(2)} L: {(data.low ?? 0).toFixed(2)}
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
            {changeSign}{(data.change ?? 0).toFixed(2)} ({changeSign}{formatPercent(data.changePct)})
          </div>
        </div>
      </div>

      {/* Metrics Row — RSI cell is only rendered when the backend has a real
         RSI(14) reading. When missing we replace it with today's H/L range
         derived from the live daily bar so the grid stays a tidy 3-col. */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg bg-bg-elev-2 border border-border-hair px-3 py-2">
          <div className="text-[12px] text-muted-foreground mb-0.5">Technical</div>
          <div className={cn(
            "text-sm font-bold tabular-nums",
            (data.technicalScore ?? 50) >= 60 ? "text-[var(--profit)]"
              : (data.technicalScore ?? 50) < 40 ? "text-[var(--loss)]"
              : "text-[var(--chart-4)]"
          )}>
            {data.technicalScore ?? "--"}/100
          </div>
        </div>
        {data.rsi != null ? (
          <div className="rounded-lg bg-bg-elev-2 border border-border-hair px-3 py-2">
            <div className="text-[12px] text-muted-foreground mb-0.5">RSI (14)</div>
            <div className="text-sm font-bold text-foreground tabular-nums">{data.rsi}</div>
          </div>
        ) : (
          <div className="rounded-lg bg-bg-elev-2 border border-border-hair px-3 py-2">
            <div className="text-[12px] text-muted-foreground mb-0.5">Today's Range</div>
            <div className="text-sm font-bold text-foreground tabular-nums">
              {(data.low ?? 0).toFixed(2)}–{(data.high ?? 0).toFixed(2)}
            </div>
          </div>
        )}
        <div className="rounded-lg bg-bg-elev-2 border border-border-hair px-3 py-2">
          <div className="text-[12px] text-muted-foreground mb-0.5">Volume</div>
          <div className="text-sm font-bold text-foreground tabular-nums">{formatVolume(data.volume)}</div>
        </div>
      </div>

      {/* Key Levels — only renders when real pivot levels are present.
         We no longer fabricate spot ± 3% bands that look authoritative
         but are just an arbitrary % cushion around the last price. */}
      {(data.support != null || data.resistance != null) && (
        <div className="flex items-center gap-4 mb-4 text-xs">
          {data.support != null && (
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--profit)]" />
              <span className="text-muted-foreground">Support:</span>
              <span className="font-medium text-[var(--profit)] tabular-nums">
                {formatCurrency(data.support)}
              </span>
            </div>
          )}
          {data.resistance != null && (
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--loss)]" />
              <span className="text-muted-foreground">Resistance:</span>
              <span className="font-medium text-[var(--loss)] tabular-nums">
                {formatCurrency(data.resistance)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* P&L if user has a position */}
      {data.pnl != null && (
        <div className={cn(
          "rounded-lg px-3 py-2 mb-4 border",
          data.pnl >= 0
            ? "bg-[var(--profit)]/5 border-[var(--profit)]/20"
            : "bg-[var(--loss)]/5 border-[var(--loss)]/20"
        )}>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground">Unrealized P&L</span>
            <span className={cn(
              "text-sm font-bold tabular-nums",
              data.pnl >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]"
            )}>
              {data.pnl >= 0 ? "+" : ""}{formatCurrency(data.pnl)}
              {data.pnlPct != null && (
                <span className="ml-1 text-[12px]">
                  ({data.pnl >= 0 ? "+" : ""}{(data.pnlPct ?? 0).toFixed(2)}%)
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* AI Summary */}
      {data.summary && (
        <div className="rounded-lg bg-primary/5 border border-primary/10 px-3 py-2 mb-4">
          <div className="text-[12px] text-primary/70 mb-1 font-medium">AI Analysis</div>
          <p className="text-[12px] text-foreground/80 leading-relaxed line-clamp-3">
            {data.summary}
          </p>
        </div>
      )}

      {/* Footer watermark */}
      <div className="flex items-center justify-between border-t border-border pt-3 mt-1">
        <div className="flex items-center gap-1.5">
          <div className="h-4 w-4 rounded bg-primary/20 flex items-center justify-center">
            <span className="text-[12px] font-bold text-primary">A</span>
          </div>
          <span className="text-[12px] font-medium text-muted-foreground">AlphaDesk</span>
        </div>
        <span className="text-[12px] text-muted-foreground/60">tradingalpha.net</span>
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
  // Prefer the real RSI(14) from the backend's technicals payload. The
  // previous implementation synthesized `40 + techScore * 0.3` which
  // looked precise but was pure fabrication — shipped as a shareable
  // claim that would not match any broker terminal.
  const realRsi = analysis?.technicals?.rsi_14;
  const rsi = typeof realRsi === "number" && Number.isFinite(realRsi)
    ? realRsi.toFixed(1)
    : null;
  // Support/resistance come from the backend's pivot detector; when
  // absent we render nothing rather than spot ± 3% placeholders.
  const realSupport = analysis?.technicals?.support;
  const realResistance = analysis?.technicals?.resistance;
  const support = typeof realSupport === "number" && Number.isFinite(realSupport)
    ? realSupport
    : null;
  const resistance = typeof realResistance === "number" && Number.isFinite(realResistance)
    ? realResistance
    : null;

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
    support,
    resistance,
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

      // Design-token aware palette. Reading at call time so updates to
      // :root propagate automatically and the PNG matches whatever the
      // user sees in the card preview.
      const bg = token("--bg", "#0b0a09");
      const border = token("--border", "#2a271d");
      const brand = token("--brand", "#c9a66b");
      const profit = token("--profit", "#a8d04d");
      const loss = token("--loss", "#e07856");
      const amber = token("--amber-500", "#d9a441");
      const fg = token("--fg", "#ece6d2");
      const fgMuted = token("--fg-muted", "#7d7665");
      const fgHint = token("--fg-hint", "#5b5547");
      const fontUi = token("--font-ui", "Inter, system-ui, sans-serif");

      // Dark background (warm near-black)
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // Border
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.roundRect(0, 0, width, height, 12);
      ctx.stroke();

      // Symbol (brand gold)
      ctx.fillStyle = brand;
      ctx.font = `bold 14px ${fontUi}`;
      ctx.fillText(cardData.symbol, 60, 32);

      // Price
      ctx.fillStyle = fg;
      ctx.font = `bold 20px ${fontUi}`;
      const priceStr = formatCurrency(cardData.price);
      const priceWidth = ctx.measureText(priceStr).width;
      ctx.fillText(priceStr, width - 20 - priceWidth, 30);

      // Change
      const changeSign = cardData.change >= 0 ? "+" : "";
      const changeColor = cardData.change >= 0 ? profit : loss;
      ctx.fillStyle = changeColor;
      ctx.font = `500 11px ${fontUi}`;
      const changeStr = `${changeSign}${(cardData.change ?? 0).toFixed(2)} (${changeSign}${formatPercent(cardData.changePct)})`;
      const changeWidth = ctx.measureText(changeStr).width;
      ctx.fillText(changeStr, width - 20 - changeWidth, 48);

      // Volume info
      ctx.fillStyle = fgMuted;
      ctx.font = `11px ${fontUi}`;
      ctx.fillText(`Vol: ${formatVolume(cardData.volume)} | H: ${(cardData.high ?? 0).toFixed(2)} L: ${(cardData.low ?? 0).toFixed(2)}`, 60, 48);

      // Metrics — use a subtle warm-black elevation for pill backgrounds
      const metricBg = token("--bg-elev-2", "#15140f");
      const metricsY = 75;
      const metricW = (width - 50) / 3;

      // Technical Score
      ctx.fillStyle = metricBg;
      ctx.fillRect(20, metricsY, metricW, 45);
      ctx.fillStyle = fgMuted;
      ctx.font = `10px ${fontUi}`;
      ctx.fillText("Technical", 28, metricsY + 15);
      ctx.fillStyle = (cardData.technicalScore ?? 50) >= 60 ? profit
        : (cardData.technicalScore ?? 50) < 40 ? loss : amber;
      ctx.font = `bold 13px ${fontUi}`;
      ctx.fillText(`${cardData.technicalScore ?? "--"}/100`, 28, metricsY + 35);

      // RSI or Today's Range — mirror the DOM card: only show real RSI.
      // When RSI isn't available fall back to the daily H/L range instead
      // of a fabricated number.
      ctx.fillStyle = metricBg;
      ctx.fillRect(20 + metricW + 5, metricsY, metricW, 45);
      ctx.fillStyle = fgMuted;
      ctx.font = `10px ${fontUi}`;
      if (cardData.rsi != null) {
        ctx.fillText("RSI (14)", 28 + metricW + 5, metricsY + 15);
        ctx.fillStyle = fg;
        ctx.font = `bold 13px ${fontUi}`;
        ctx.fillText(cardData.rsi, 28 + metricW + 5, metricsY + 35);
      } else {
        ctx.fillText("Today's Range", 28 + metricW + 5, metricsY + 15);
        ctx.fillStyle = fg;
        ctx.font = `bold 13px ${fontUi}`;
        const rangeLabel = `${(cardData.low ?? 0).toFixed(2)}–${(cardData.high ?? 0).toFixed(2)}`;
        ctx.fillText(rangeLabel, 28 + metricW + 5, metricsY + 35);
      }

      // Volume metric
      ctx.fillStyle = metricBg;
      ctx.fillRect(20 + (metricW + 5) * 2, metricsY, metricW, 45);
      ctx.fillStyle = fgMuted;
      ctx.font = `10px ${fontUi}`;
      ctx.fillText("Volume", 28 + (metricW + 5) * 2, metricsY + 15);
      ctx.fillStyle = fg;
      ctx.font = `bold 13px ${fontUi}`;
      ctx.fillText(formatVolume(cardData.volume), 28 + (metricW + 5) * 2, metricsY + 35);

      // Key Levels — only paint the row when we have at least one real
      // pivot level. Missing side renders as an em-dash rather than N/A
      // so the card stays composed.
      let yOffset = metricsY + 65;
      if (cardData.support != null || cardData.resistance != null) {
        if (cardData.support != null) {
          ctx.fillStyle = profit;
          ctx.beginPath();
          ctx.arc(28, yOffset, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = fgMuted;
          ctx.font = `11px ${fontUi}`;
          ctx.fillText("Support:", 36, yOffset + 4);
          ctx.fillStyle = profit;
          ctx.font = `500 11px ${fontUi}`;
          ctx.fillText(formatCurrency(cardData.support), 88, yOffset + 4);
        }

        if (cardData.resistance != null) {
          ctx.fillStyle = loss;
          ctx.beginPath();
          ctx.arc(width / 2 + 10, yOffset, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = fgMuted;
          ctx.font = `11px ${fontUi}`;
          ctx.fillText("Resistance:", width / 2 + 18, yOffset + 4);
          ctx.fillStyle = loss;
          ctx.font = `500 11px ${fontUi}`;
          ctx.fillText(formatCurrency(cardData.resistance), width / 2 + 82, yOffset + 4);
        }

        yOffset += 25;
      }

      // P&L
      if (cardData.pnl != null) {
        const pnlColor = cardData.pnl >= 0 ? profit : loss;
        // Translucent fill — approx 0.05 alpha
        ctx.fillStyle = pnlColor + "14";
        ctx.fillRect(20, yOffset, width - 40, 32);
        ctx.fillStyle = fgMuted;
        ctx.font = `10px ${fontUi}`;
        ctx.fillText("Unrealized P&L", 28, yOffset + 14);
        ctx.fillStyle = pnlColor;
        ctx.font = `bold 12px ${fontUi}`;
        const pnlStr = `${cardData.pnl >= 0 ? "+" : ""}${formatCurrency(cardData.pnl)}`;
        const pnlW = ctx.measureText(pnlStr).width;
        ctx.fillText(pnlStr, width - 28 - pnlW, yOffset + 22);
        yOffset += 42;
      }

      // AI Summary — faint brand tint instead of the old blue
      if (cardData.summary) {
        ctx.fillStyle = brand + "0d"; // ~5% alpha
        ctx.fillRect(20, yOffset, width - 40, 50);
        ctx.fillStyle = brand;
        ctx.font = `500 10px ${fontUi}`;
        ctx.fillText("AI Analysis", 28, yOffset + 14);
        ctx.fillStyle = fg;
        ctx.font = `11px ${fontUi}`;
        const summaryTruncated = cardData.summary.length > 100 ? cardData.summary.slice(0, 100) + "..." : cardData.summary;
        ctx.fillText(summaryTruncated, 28, yOffset + 32);
        yOffset += 60;
      }

      // Footer
      ctx.fillStyle = border;
      ctx.fillRect(20, yOffset, width - 40, 1);
      yOffset += 15;
      ctx.fillStyle = brand;
      ctx.font = `bold 8px ${fontUi}`;
      ctx.fillText("A", 28, yOffset + 4);
      ctx.fillStyle = fgMuted;
      ctx.font = `500 10px ${fontUi}`;
      ctx.fillText("AlphaDesk", 40, yOffset + 4);
      ctx.fillStyle = fgHint;
      ctx.font = `9px ${fontUi}`;
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
        <DialogContent className="max-w-[480px] bg-[var(--surface)] border-border p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-0">
            <DialogTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Share2 className="h-4 w-4 text-primary" />
              Share Trade Idea
            </DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground">
              Share your {selectedSymbol} analysis as a card or text summary.
            </DialogDescription>
          </DialogHeader>

          {/* Card Preview */}
          <div className="px-5 py-4 flex justify-center" ref={cardRef}>
            <ShareCard data={cardData} />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 border-t border-border px-5 py-3 bg-[var(--bg)]">
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
