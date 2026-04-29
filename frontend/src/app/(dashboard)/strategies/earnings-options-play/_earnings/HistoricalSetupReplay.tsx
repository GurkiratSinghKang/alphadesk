"use client";

import { useEffect, useMemo, useState } from "react";
import { postEarningsBacktest } from "@/lib/api";
import { fmtDate, fmtNumber, fmtPct } from "@/lib/intl";
import { cn } from "@/lib/utils";
import type {
  EarningsBacktestRequest,
  EarningsBacktestResponse,
  EarningsBacktestTrade,
  EarningsDetail,
  EarningsOptionSide,
  EarningsTopSetup,
} from "@/types";

interface HistoricalSetupReplayProps {
  detail: EarningsDetail;
}

type ReplayState =
  | { status: "idle" }
  | { status: "success"; requestKey: string; data: EarningsBacktestResponse }
  | { status: "error"; requestKey: string; message: string };

const ACTIONABLE_REPLAY_SETUPS = [
  "long call",
  "long put",
  "bull put spread",
  "bear call spread",
  "bull call spread",
  "bear put spread",
  "iron condor",
  "long straddle",
] as const satisfies readonly EarningsTopSetup[];

const ACTIONABLE_REPLAY_SETUP_SET = new Set<EarningsTopSetup>(ACTIONABLE_REPLAY_SETUPS);
type ReplayMetrics = EarningsBacktestResponse["metrics"];
type SetupReplaySummary = {
  setup: EarningsTopSetup;
  trades: EarningsBacktestTrade[];
  metrics: ReplayMetrics;
};
const REPLAY_RISK_FRACTION = 0.01;
const MAX_REPLAY_EVENTS = 64;

export default function HistoricalSetupReplay({ detail }: HistoricalSetupReplayProps) {
  const request = useMemo(() => buildHistoricalReplayComparisonRequest(detail), [detail]);
  const requestKey = useMemo(() => (request ? JSON.stringify(request) : ""), [request]);
  const unavailableReason = useMemo(() => getReplayUnavailableReason(detail), [detail]);
  const [state, setState] = useState<ReplayState>({ status: "idle" });

  useEffect(() => {
    if (!request) return;

    const controller = new AbortController();
    postEarningsBacktest(request, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: "success", requestKey, data });
      })
      .catch((err) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        const message = err instanceof Error ? err.message : "Replay failed";
        setState({ status: "error", requestKey, message });
      });

    return () => controller.abort();
  }, [request, requestKey]);

  if (!detail.historicalEarnings?.quarters.length || !detail.claudeStructured) {
    return null;
  }

  const setup = detail.claudeStructured.suggestedPlay;
  if (unavailableReason) {
    return (
      <section
        data-slot="historical-setup-replay"
        className="mt-4 rounded border border-[color:var(--border)] bg-transparent p-3"
      >
        <ReplayHeader setup={setup} />
        <p className="mt-1 t-mono text-[12px] u-muted">— {unavailableReason}</p>
      </section>
    );
  }

  const loading = request && (state.status === "idle" || state.requestKey !== requestKey);
  const error = state.status === "error" && state.requestKey === requestKey ? state.message : null;
  const data = state.status === "success" && state.requestKey === requestKey ? state.data : null;
  return (
    <section
      data-slot="historical-setup-replay"
      className="mt-4 rounded border border-[color:var(--border)] bg-transparent p-3"
    >
      <ReplayHeader setup={setup} />
      {loading && (
        <p role="status" className="mt-1 t-mono text-[12px] u-muted">
          Calculating replay...
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 t-mono text-[12px] text-[color:var(--fg-neg)]">
          {error}
        </p>
      )}
      {data && (
        <ReplayResult
          data={data}
          suggestedSetup={setup}
          riskFraction={request?.riskFraction ?? REPLAY_RISK_FRACTION}
        />
      )}
    </section>
  );
}

export function buildHistoricalReplayRequest(
  detail: EarningsDetail,
): EarningsBacktestRequest | null {
  const quarters = detail.historicalEarnings?.quarters ?? [];
  const setup = detail.claudeStructured?.suggestedPlay;
  const expectedMovePct = detail.metrics?.expectedMovePct;
  if (!quarters.length || !setup || !ACTIONABLE_REPLAY_SETUP_SET.has(setup)) return null;
  if (!Number.isFinite(expectedMovePct) || (expectedMovePct ?? 0) <= 0) return null;

  const callYield = findAtmYield(detail, "call");
  const putYield = findAtmYield(detail, "put");
  if (!hasRequiredPremium(setup, callYield, putYield)) return null;

  return {
    riskFraction: REPLAY_RISK_FRACTION,
    events: quarters.map((quarter) => ({
      symbol: detail.symbol,
      reportDate: quarter.reportDate,
      topSetup: setup,
      expectedMovePct: expectedMovePct!,
      realizedMovePct: quarter.nextDayMovePct,
      premiumYieldCallAtm: callYield,
      premiumYieldPutAtm: putYield,
    })),
  };
}

export function buildHistoricalReplayComparisonRequest(
  detail: EarningsDetail,
): EarningsBacktestRequest | null {
  const quarters = detail.historicalEarnings?.quarters ?? [];
  const setup = detail.claudeStructured?.suggestedPlay;
  const expectedMovePct = detail.metrics?.expectedMovePct;
  if (!quarters.length || !setup || !ACTIONABLE_REPLAY_SETUP_SET.has(setup)) return null;
  if (!Number.isFinite(expectedMovePct) || (expectedMovePct ?? 0) <= 0) return null;

  const callYield = findAtmYield(detail, "call");
  const putYield = findAtmYield(detail, "put");
  const setups = ACTIONABLE_REPLAY_SETUPS.filter((candidate) =>
    hasRequiredPremium(candidate, callYield, putYield),
  );
  if (!setups.length || !hasRequiredPremium(setup, callYield, putYield)) return null;

  const quartersPerSetup = Math.max(1, Math.floor(MAX_REPLAY_EVENTS / setups.length));
  const replayQuarters = quarters.slice(0, quartersPerSetup);
  return {
    riskFraction: REPLAY_RISK_FRACTION,
    events: setups.flatMap((candidate) =>
      replayQuarters.map((quarter) => ({
        symbol: detail.symbol,
        reportDate: quarter.reportDate,
        topSetup: candidate,
        expectedMovePct: expectedMovePct!,
        realizedMovePct: quarter.nextDayMovePct,
        premiumYieldCallAtm: callYield,
        premiumYieldPutAtm: putYield,
      })),
    ),
  };
}

function getReplayUnavailableReason(detail: EarningsDetail): string | null {
  const quarters = detail.historicalEarnings?.quarters ?? [];
  const setup = detail.claudeStructured?.suggestedPlay;
  const expectedMovePct = detail.metrics?.expectedMovePct;
  if (!quarters.length || !setup) return null;
  if (!ACTIONABLE_REPLAY_SETUP_SET.has(setup)) {
    return "play is not ticketable by the current replay/order flow";
  }
  if (!Number.isFinite(expectedMovePct) || (expectedMovePct ?? 0) <= 0) {
    return "expected move unavailable";
  }
  const callYield = findAtmYield(detail, "call");
  const putYield = findAtmYield(detail, "put");
  if (!hasRequiredPremium(setup, callYield, putYield)) return "ATM option premium unavailable";
  return null;
}

function findAtmYield(detail: EarningsDetail, side: EarningsOptionSide): number | null {
  const row = detail.strikeLadder?.rows.find((r) => r.bucket === "ATM" && r.side === side);
  if (!row || !Number.isFinite(row.yieldPct) || row.yieldPct <= 0) return null;
  return row.yieldPct;
}

function hasRequiredPremium(
  setup: EarningsTopSetup,
  callYield: number | null,
  putYield: number | null,
): boolean {
  if (setup === "bull put spread" || setup === "bear put spread" || setup === "long put") {
    return putYield != null;
  }
  if (setup === "bear call spread" || setup === "bull call spread" || setup === "long call") {
    return callYield != null;
  }
  return callYield != null && putYield != null;
}

function ReplayHeader({ setup }: { setup: string }) {
  return (
    <h3 className="t-display-section italic text-[13px]">
      Setup replay <span className="t-label u-muted">· {setup}</span>
    </h3>
  );
}

function ReplayResult({
  data,
  suggestedSetup,
  riskFraction,
}: {
  data: EarningsBacktestResponse;
  suggestedSetup: EarningsTopSetup;
  riskFraction: number;
}) {
  const summaries = summarizeTradesBySetup(data.trades, riskFraction);
  const rankedSummaries = [...summaries].sort(compareSetupSummaries);
  const suggestedSummary =
    summaries.find((summary) => summary.setup === suggestedSetup) ?? rankedSummaries[0] ?? null;
  const bestSetup = rankedSummaries[0]?.setup ?? null;
  const metrics = suggestedSummary?.metrics ?? data.metrics;
  const latestTrades = (suggestedSummary?.trades ?? data.trades).slice(-4).reverse();
  const verdict = getReplayVerdict(metrics);
  return (
    <>
      <div
        data-slot="historical-setup-replay-verdict"
        className="mt-2 flex flex-wrap items-center gap-2 t-mono text-[11px]"
      >
        <span
          className={
            "rounded border px-1.5 py-0.5 uppercase " +
            (verdict.tone === "pos"
              ? "border-[color:var(--fg-pos)] u-profit"
              : verdict.tone === "neg"
              ? "border-[color:var(--fg-neg)] u-loss"
              : "border-[color:var(--border)] u-muted")
          }
        >
          {verdict.label}
        </span>
        <span className="u-muted">
          {metrics.events} suggested-play replay{metrics.events === 1 ? "" : "s"} using current
          premium and implied move.
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ReplayStat label="WIN" value={fmtPct(metrics.winRate, 0)} />
        <ReplayStat
          label="AVG R"
          value={fmtPct(metrics.avgTradeReturnPct, 1, { signDisplay: "always" })}
          tone={metrics.avgTradeReturnPct >= 0 ? "pos" : "neg"}
        />
        <ReplayStat
          label="EQUITY"
          value={fmtPct(metrics.totalReturnPct, 2, { signDisplay: "always" })}
          tone={metrics.totalReturnPct >= 0 ? "pos" : "neg"}
        />
        <ReplayStat label="PF" value={formatProfitFactor(metrics.profitFactor, metrics.events)} />
      </dl>
      {rankedSummaries.length > 1 && (
        <div
          data-slot="historical-setup-replay-comparison"
          className="mt-3 border-t border-[color:var(--border)] pt-2"
        >
          <div className="grid grid-cols-[minmax(0,1.4fr)_3.25rem_4.25rem_3.5rem] gap-2 t-label u-muted">
            <span>Setup comparison</span>
            <span className="text-right">WIN</span>
            <span className="text-right">AVG R</span>
            <span className="text-right">PF</span>
          </div>
          <ul className="mt-1 divide-y divide-[color:var(--border)]">
            {rankedSummaries.map((summary) => (
              <SetupComparisonRow
                key={summary.setup}
                summary={summary}
                suggested={summary.setup === suggestedSetup}
                best={summary.setup === bestSetup}
              />
            ))}
          </ul>
        </div>
      )}
      {latestTrades.length > 0 ? (
        <ul
          data-slot="historical-setup-replay-trades"
          className="mt-3 divide-y divide-[color:var(--border)] border-t border-[color:var(--border)]"
        >
          {latestTrades.map((trade) => (
            <ReplayTradeRow key={`${trade.symbol}-${trade.reportDate}`} trade={trade} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 t-mono text-[12px] u-muted">— no replayable events.</p>
      )}
      {data.skipped.length > 0 && (
        <p data-slot="historical-setup-replay-skipped" className="mt-2 t-mono text-[11px] u-muted">
          {data.skipped.length} skipped
        </p>
      )}
      <p className="mt-2 t-mono text-[10.5px] u-muted">
        Setup replay only: not point-in-time historical option-chain fills.
      </p>
    </>
  );
}

function summarizeTradesBySetup(
  trades: EarningsBacktestTrade[],
  riskFraction: number,
): SetupReplaySummary[] {
  const grouped = new Map<EarningsTopSetup, EarningsBacktestTrade[]>();
  for (const trade of trades) {
    if (!ACTIONABLE_REPLAY_SETUP_SET.has(trade.setup as EarningsTopSetup)) continue;
    const setup = trade.setup as EarningsTopSetup;
    const rows = grouped.get(setup) ?? [];
    rows.push(trade);
    grouped.set(setup, rows);
  }
  return ACTIONABLE_REPLAY_SETUPS.flatMap((setup) => {
    const setupTrades = grouped.get(setup) ?? [];
    if (!setupTrades.length) return [];
    return [{ setup, trades: setupTrades, metrics: computeReplayMetrics(setupTrades, riskFraction) }];
  });
}

function computeReplayMetrics(
  trades: EarningsBacktestTrade[],
  riskFraction: number,
): ReplayMetrics {
  let equity = 1.0;
  let peak = 1.0;
  let maxDrawdownPct = 0.0;
  for (const trade of trades) {
    equity *= Math.max(0.0, 1.0 + trade.returnPct * riskFraction);
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peak - equity) / peak);
  }
  const wins = trades.filter((trade) => trade.win).length;
  const grossWins = trades
    .filter((trade) => trade.returnPct > 0)
    .reduce((sum, trade) => sum + trade.returnPct, 0);
  const grossLosses = Math.abs(
    trades
      .filter((trade) => trade.returnPct < 0)
      .reduce((sum, trade) => sum + trade.returnPct, 0),
  );
  return {
    events: trades.length,
    winRate: trades.length ? wins / trades.length : 0,
    avgTradeReturnPct: trades.length
      ? trades.reduce((sum, trade) => sum + trade.returnPct, 0) / trades.length
      : 0,
    totalReturnPct: equity - 1.0,
    maxDrawdownPct,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : null,
  };
}

function compareSetupSummaries(a: SetupReplaySummary, b: SetupReplaySummary): number {
  if (b.metrics.avgTradeReturnPct !== a.metrics.avgTradeReturnPct) {
    return b.metrics.avgTradeReturnPct - a.metrics.avgTradeReturnPct;
  }
  if (b.metrics.winRate !== a.metrics.winRate) return b.metrics.winRate - a.metrics.winRate;
  return a.setup.localeCompare(b.setup);
}

function getReplayVerdict(metrics: EarningsBacktestResponse["metrics"]): {
  label: string;
  tone?: "pos" | "neg";
} {
  if (metrics.events < 3) return { label: "Thin sample" };
  if (metrics.avgTradeReturnPct < 0 || metrics.winRate < 0.45) {
    return { label: "Avoid", tone: "neg" };
  }
  if (metrics.avgTradeReturnPct > 0 && metrics.winRate >= 0.6) {
    return { label: "Replay pass", tone: "pos" };
  }
  return { label: "Watch" };
}

function ReplayStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="min-w-0 rounded border border-[color:var(--border)] px-2 py-1.5">
      <dt className="t-label u-muted">{label}</dt>
      <dd
        className={
          "mt-0.5 t-mono text-[13px] " +
          (tone === "pos" ? "u-profit" : tone === "neg" ? "u-loss" : "")
        }
      >
        {value}
      </dd>
    </div>
  );
}

function SetupComparisonRow({
  summary,
  suggested,
  best,
}: {
  summary: SetupReplaySummary;
  suggested: boolean;
  best: boolean;
}) {
  const metrics = summary.metrics;
  const verdict = getReplayVerdict(metrics);
  return (
    <li className="grid grid-cols-[minmax(0,1.4fr)_3.25rem_4.25rem_3.5rem] items-center gap-2 py-1.5 t-mono text-[11px]">
      <span className="min-w-0 truncate">
        <span
          className={cn(
            "inline-block max-w-[9rem] truncate align-bottom",
            best ? "u-profit" : suggested ? "u-brand" : "u-muted",
          )}
        >
          {summary.setup}
        </span>
        <span className="ml-1 u-muted">
          {suggested ? "suggested" : best ? "best" : verdict.label.toLowerCase()}
        </span>
      </span>
      <span className="text-right tabular-nums">{fmtPct(metrics.winRate, 0)}</span>
      <span
        className={
          "text-right tabular-nums " +
          (metrics.avgTradeReturnPct >= 0 ? "u-profit" : "u-loss")
        }
      >
        {fmtPct(metrics.avgTradeReturnPct, 1, { signDisplay: "always" })}
      </span>
      <span className="text-right tabular-nums">
        {formatProfitFactor(metrics.profitFactor, metrics.events)}
      </span>
    </li>
  );
}

function ReplayTradeRow({ trade }: { trade: EarningsBacktestTrade }) {
  return (
    <li className="grid grid-cols-[6.5rem_4.5rem_minmax(0,1fr)] gap-2 py-2 t-mono text-[11px]">
      <span className="u-muted">{fmtDate(trade.reportDate, { year: "numeric", month: "short", day: "numeric" })}</span>
      <span className={trade.win ? "u-profit" : "u-loss"}>
        {fmtPct(trade.returnPct, 1, { signDisplay: "always" })}
      </span>
      <span className="min-w-0 truncate u-muted" title={trade.reason}>
        {trade.reason}
      </span>
    </li>
  );
}

function formatProfitFactor(value: number | null, events: number): string {
  if (value == null) return events > 0 ? "∞" : "—";
  return fmtNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
