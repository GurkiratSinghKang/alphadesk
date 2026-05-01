import type { ChartRange } from "@/components/composites";
import type { TimeFrame } from "@/types";

export function barsRequestForRange(r: ChartRange): { timeframe: TimeFrame; limit: number } {
  switch (r) {
    case "1D":
      return { timeframe: "5m", limit: 100 };
    case "5D":
      return { timeframe: "15m", limit: 160 };
    case "1M":
      return { timeframe: "1H", limit: 180 };
    case "3M":
      return { timeframe: "D", limit: 66 };
    case "6M":
      return { timeframe: "D", limit: 132 };
    case "YTD":
    case "1Y":
      return { timeframe: "D", limit: 260 };
    case "ALL":
      return { timeframe: "W", limit: 520 };
  }
}
