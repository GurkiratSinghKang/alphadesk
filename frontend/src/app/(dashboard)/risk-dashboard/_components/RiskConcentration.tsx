"use client";

import * as React from "react";

import Section from "@/components/composites/Section";
import { cn } from "@/lib/utils";

interface ConcentrationRow {
  scope: "name" | "sector" | "strategy";
  label: string;
  pctNAV: number;
  capPctNAV: number;
}

const ROWS: ConcentrationRow[] = [
  { scope: "name", label: "NVDA", pctNAV: 7.2, capPctNAV: 8 },
  { scope: "name", label: "MSFT", pctNAV: 6.4, capPctNAV: 8 },
  { scope: "name", label: "AAPL", pctNAV: 5.8, capPctNAV: 8 },
  { scope: "sector", label: "Information Tech", pctNAV: 38.4, capPctNAV: 35 },
  { scope: "sector", label: "Industrials", pctNAV: 14.2, capPctNAV: 25 },
  { scope: "strategy", label: "Momentum + Quality", pctNAV: 22.4, capPctNAV: 25 },
  { scope: "strategy", label: "PEAD", pctNAV: 9.6, capPctNAV: 25 },
];

const SCOPE_LABEL: Record<ConcentrationRow["scope"], string> = {
  name: "Per name",
  sector: "Per sector",
  strategy: "Per strategy",
};

export default function RiskConcentration() {
  return (
    <Section
      eyebrow="RISK · CONCENTRATION"
      title="Concentration limits"
      description="Per name · per sector · per strategy. Bars show utilization vs cap."
    >
      <div className="rounded-md border border-border-hair bg-bg-elev-1 overflow-hidden">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="bg-bg-elev-2 text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
              <th className="text-left px-3 py-2 font-semibold">Scope</th>
              <th className="text-left px-3 py-2 font-semibold">Name</th>
              <th className="text-right px-3 py-2 font-semibold">% NAV</th>
              <th className="text-right px-3 py-2 font-semibold">Cap</th>
              <th className="text-left px-3 py-2 font-semibold w-1/3">Utilization</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, i) => {
              const utilization = (row.pctNAV / row.capPctNAV) * 100;
              const overCap = utilization > 100;
              return (
                <tr
                  key={`${row.scope}-${row.label}-${i}`}
                  className={cn(
                    "border-t border-border-hair",
                    overCap && "bg-tint-down-1/40",
                  )}
                >
                  <td className="px-3 py-2 text-eyebrow uppercase tracking-[0.08em] text-fg-muted font-semibold">
                    {SCOPE_LABEL[row.scope]}
                  </td>
                  <td className="px-3 py-2 text-fg font-medium">{row.label}</td>
                  <td className={cn("px-3 py-2 text-right t-mono", overCap ? "text-loss" : "text-fg")}>
                    {row.pctNAV.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right t-mono text-fg-muted">{row.capPctNAV}%</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-pill bg-bg-elev-2 overflow-hidden">
                        <div
                          className={cn(
                            "h-full",
                            overCap
                              ? "bg-loss"
                              : utilization > 80
                              ? "bg-state-warning"
                              : "bg-profit",
                          )}
                          style={{ width: `${Math.min(utilization, 100)}%` }}
                        />
                      </div>
                      <span
                        className={cn(
                          "text-eyebrow uppercase tracking-[0.08em] font-semibold w-12 text-right",
                          overCap ? "text-loss" : "text-fg-muted",
                        )}
                      >
                        {Math.round(utilization)}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
