"use client";

import { useEffect, useMemo, useState } from "react";
import { postEarningsBacktest } from "@/lib/api";
import { fmtDate, fmtNumber, fmtPct } from "@/lib/intl";
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

const SUPPORTED_REPLAY_SETUPS = new Set<EarningsTopSetup>([
  "bull put spread",
  "bear call spread",
  "bull call spread",
  "bear put spread",
  "iron condor",
  "iron butterfly",
  "calendar spread",
  "diagonal spread",
  "long straddle",
]);

export default function HistoricalSetupReplay({ detail }: HistoricalSetupReplayProps) {
  const request = useMemo(() => buildHistoricalReplayRequest(detail), [detail]);
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
      {data && <ReplayResult data={data} />}
    </section>
  );
}

export function buildHistoricalReplayRequest(
  detail: EarningsDetail,
): EarningsBacktestRequest | null {
  const quarters = detail.historicalEarnings?.quarters ?? [];
  const setup = detail.claudeStructured?.suggestedPlay;
  const expectedMovePct = detail.metrics?.expectedMovePct;
  if (!quarters.length || !setup || !SUPPORTED_REPLAY_SETUPS.has(setup)) return null;
  if (!Number.isFinite(expectedMovePct) || (expectedMovePct ?? 0) <= 0) return null;

  const callYield = findAtmYield(detail, "call");
  const putYield = findAtmYield(detail, "put");
  if (!hasRequiredPremium(setup, callYield, putYield)) return null;

  return {
    riskFraction: 0.01,
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

function getReplayUnavailableReason(detail: EarningsDetail): string | null {
  const quarters = detail.historicalEarnings?.quarters ?? [];
  const setup = detail.claudeStructured?.suggestedPlay;
  const expectedMovePct = detail.metrics?.expectedMovePct;
  if (!quarters.length || !setup) return null;
  if (!SUPPORTED_REPLAY_SETUPS.has(setup)) return "play not supported by replay model";
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
  if (setup === "bull put spread" || setup === "bear put spread") {
    return putYield != null;
  }
  if (setup === "bear call spread" || setup === "bull call spread") {
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

function ReplayResult({ data }: { data: EarningsBacktestResponse }) {
  const metrics = data.metrics;
  const latestTrades = data.trades.slice(-4).reverse();
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
          {metrics.events} replayed event{metrics.events === 1 ? "" : "s"} using current premium
          and implied move.
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
