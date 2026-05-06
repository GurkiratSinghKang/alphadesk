export type VerdictTone = "buy" | "hold" | "sell" | "neutral";

export function verdictTone(action: string | undefined | null): VerdictTone {
  if (!action) return "neutral";
  const a = action.toLowerCase().trim();
  if (!a) return "neutral";

  if (
    a.includes("long call") ||
    a.includes("long_call") ||
    a.includes("bull call") ||
    a.includes("bull put") ||
    a.startsWith("bull_") ||
    a === "buy" ||
    a === "long" ||
    a === "bullish"
  ) {
    return "buy";
  }

  if (
    a.includes("long put") ||
    a.includes("long_put") ||
    a.includes("bear call") ||
    a.includes("bear put") ||
    a.startsWith("bear_") ||
    a === "sell" ||
    a === "short" ||
    a === "bearish" ||
    a.includes("married put")
  ) {
    return "sell";
  }

  if (
    a === "hold" ||
    a === "neutral" ||
    a.includes("iron condor") ||
    a.includes("iron butterfly") ||
    a.includes("calendar spread") ||
    a.includes("diagonal spread") ||
    a.includes("long straddle") ||
    a.includes("cash-secured put") ||
    a.includes("covered call") ||
    a.includes("short strangle") ||
    a.includes("short call")
  ) {
    return "hold";
  }

  return "neutral";
}

export function verdictBorderVar(tone: VerdictTone): string {
  if (tone === "buy") return "var(--profit)";
  if (tone === "sell") return "var(--loss)";
  if (tone === "hold") return "var(--border-strong)";
  return "var(--border-strong)";
}

export function verdictLabel(tone: VerdictTone): string {
  if (tone === "buy") return "BUY";
  if (tone === "sell") return "SELL";
  if (tone === "hold") return "HOLD";
  return "NEUTRAL";
}
