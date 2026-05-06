"use client";

import type { EarningsMetricsBlock } from "@/types";
import { fmtPct } from "@/lib/intl";

import type { IVDataResult } from "../_hooks/useSymbolPageData";

export interface IVStatRowProps {
  ivData: IVDataResult | null;
  metrics?: EarningsMetricsBlock | null;
}

export function IVStatRow({ ivData, metrics }: IVStatRowProps) {
  if (!ivData || ivData.currentIV == null) return null;

  const fmtRank = (n: number | null | undefined): string =>
    n == null || !Number.isFinite(n) ? "—" : n.toFixed(0);

  const hv20 = metrics?.hv20 ?? null;
  const hv50 = metrics?.hv50 ?? null;
  const hv100 = metrics?.hv100 ?? null;
  const expectedMovePct = metrics?.expectedMovePct ?? null;

  return (
    <div
      data-testid="iv-stat-row"
      data-slot="iv-stat-row"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
    >
      <Stat label="IV" value={fmtPct(ivData.currentIV, 1)} />
      <Stat label="IVR" value={fmtRank(ivData.ivRank)} />
      <Stat label="IVP" value={fmtRank(ivData.ivPctl)} />
      {hv20 != null ? <Stat label="HV20" value={fmtPct(hv20, 1)} /> : null}
      {hv50 != null ? <Stat label="HV50" value={fmtPct(hv50, 1)} /> : null}
      {hv100 != null ? <Stat label="HV100" value={fmtPct(hv100, 1)} /> : null}
      {expectedMovePct != null ? (
        <Stat label="EXP MOVE" value={fmtPct(expectedMovePct, 1, { signDisplay: "never" })} />
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="t-label u-muted">{label}</p>
      <p className="t-mono text-body-sm tabular-nums">{value}</p>
    </div>
  );
}

export default IVStatRow;
