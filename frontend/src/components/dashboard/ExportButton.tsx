"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTradeHistory } from "@/lib/api";

export function ExportButton() {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const trades = await getTradeHistory(1000);

      if (!trades || trades.length === 0) {
        // Dispatch error event for toast system
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("alphadesk:api-error", {
              detail: {
                status: 0,
                message: "No trade history to export",
                path: "/export",
              },
            })
          );
        }
        return;
      }

      // Build CSV
      const headers = [
        "Date",
        "Symbol",
        "Side",
        "Shares",
        "Entry Price",
        "Exit Price",
        "P&L",
        "P&L %",
        "Strategy",
        "Status",
      ];

      const rows = trades.map((t) => [
        t.entry_time ? new Date(t.entry_time).toISOString().slice(0, 10) : "",
        t.symbol,
        t.side,
        t.quantity,
        t.entry_price?.toFixed(2) ?? "",
        t.exit_price?.toFixed(2) ?? "",
        t.pnl?.toFixed(2) ?? "",
        t.pnl_pct?.toFixed(2) ?? "",
        t.strategy ?? "",
        t.status,
      ]);

      // CSV-injection hardening: Excel/Sheets treat any cell starting
      // with `=`, `+`, `-`, `@`, TAB or CR as a formula. Symbol names or
      // strategy identifiers from upstream data (or a negative P&L like
      // `-12.34`) would then execute on open. Prefix the sentinel `'`
      // per OWASP so such cells render verbatim.
      const CSV_INJECTION_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];
      const escapeCell = (cell: unknown): string => {
        let str = String(cell ?? "");
        if (str.length > 0 && CSV_INJECTION_PREFIXES.includes(str[0])) {
          str = `'${str}`;
        }
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const csvContent = [
        headers.map(escapeCell).join(","),
        ...rows.map((row) => row.map(escapeCell).join(",")),
      ].join("\n");

      // Download
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `alphadesk-trades-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Button
      onClick={handleExport}
      variant="outline"
      size="sm"
      className="text-label gap-1.5"
      disabled={exporting}
    >
      {exporting ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Download className="h-3 w-3" />
      )}
      {exporting ? "Exporting..." : "Export P&L"}
    </Button>
  );
}
