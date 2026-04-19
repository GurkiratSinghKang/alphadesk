"""Report writer — JSON + self-contained HTML with embedded PNG charts."""

from __future__ import annotations

import base64
import io
import json
import logging
import os
from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("alphadesk.backtest.report")

import numpy as np
import pandas as pd

# Matplotlib: force the 'Agg' backend so this works in headless / test
# environments.
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from backtest.types import BacktestResult


def _json_default(o: Any) -> Any:
    if isinstance(o, Decimal):
        return str(o)
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    if is_dataclass(o):
        return asdict(o)
    if hasattr(o, "__dict__"):
        return o.__dict__
    return str(o)


class ReportWriter:
    """Write a :class:`BacktestResult` to disk as JSON + HTML."""

    def __init__(self, output_dir: str | Path):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def write(
        self,
        result: BacktestResult,
        *,
        name: str = "backtest",
        benchmark_equity: Optional[pd.Series] = None,
    ) -> dict[str, Path]:
        json_path = self.output_dir / f"{name}.json"
        html_path = self.output_dir / f"{name}.html"

        json_path.write_text(
            json.dumps(
                self._serialisable(result, benchmark_equity=benchmark_equity),
                default=_json_default,
                indent=2,
            )
        )

        charts = self._render_charts(result, benchmark_equity=benchmark_equity)
        html_path.write_text(self._render_html(result, charts))

        return {"json": json_path, "html": html_path}

    # ------------------------------------------------------------------
    # JSON
    # ------------------------------------------------------------------

    def _serialisable(
        self,
        result: BacktestResult,
        *,
        benchmark_equity: Optional[pd.Series],
    ) -> dict[str, Any]:
        eq = result.equity_curve
        if isinstance(eq, pd.DataFrame) and not eq.empty:
            eq_records = eq.reset_index().to_dict(orient="records")
        else:
            eq_records = []

        return {
            "strategy": result.strategy_name,
            "start": result.start.isoformat() if result.start else None,
            "end": result.end.isoformat() if result.end else None,
            "params": result.params,
            "metrics": result.metrics,
            "equity_curve": eq_records,
            "trades": [asdict(t) for t in result.trades],
            "fills": [asdict(f) for f in result.fills],
            "daily_returns": (
                result.daily_returns.reset_index().to_dict(orient="records")
                if result.daily_returns is not None and not result.daily_returns.empty
                else []
            ),
        }

    # ------------------------------------------------------------------
    # Charts
    # ------------------------------------------------------------------

    def _render_charts(
        self,
        result: BacktestResult,
        *,
        benchmark_equity: Optional[pd.Series],
    ) -> dict[str, str]:
        """Return dict of chart name -> base64-encoded PNG data URIs."""

        charts: dict[str, str] = {}
        eq = result.equity_curve
        if eq is None or (isinstance(eq, pd.DataFrame) and eq.empty):
            return charts

        eq_series = eq["equity"] if "equity" in eq.columns else eq.iloc[:, 0]

        charts["equity"] = _fig_to_datauri(self._plot_equity(eq_series, benchmark_equity))
        charts["drawdown"] = _fig_to_datauri(self._plot_drawdown(eq_series))

        returns = result.daily_returns
        if returns is not None and not returns.empty:
            charts["returns_hist"] = _fig_to_datauri(self._plot_returns_hist(returns))
            charts["monthly_heatmap"] = _fig_to_datauri(
                self._plot_monthly_heatmap(returns)
            )
        return charts

    def _plot_equity(
        self,
        equity: pd.Series,
        benchmark_equity: Optional[pd.Series],
    ) -> "plt.Figure":
        fig, ax = plt.subplots(figsize=(8, 3.5), dpi=110)
        ax.plot(equity.index, equity.values, label="Strategy", linewidth=1.3)
        if benchmark_equity is not None and not benchmark_equity.empty:
            bench = benchmark_equity.reindex(equity.index).ffill()
            if not bench.empty and bench.iloc[0] > 0:
                normalised = bench / float(bench.iloc[0]) * float(equity.iloc[0])
                ax.plot(
                    normalised.index,
                    normalised.values,
                    label="Benchmark",
                    linewidth=1.0,
                    alpha=0.7,
                )
        ax.set_title("Equity curve")
        ax.set_ylabel("Equity")
        ax.grid(True, alpha=0.25)
        ax.legend(loc="best", fontsize=8)
        fig.tight_layout()
        return fig

    def _plot_drawdown(self, equity: pd.Series) -> "plt.Figure":
        running_max = equity.cummax()
        dd = equity / running_max - 1.0
        fig, ax = plt.subplots(figsize=(8, 2.5), dpi=110)
        ax.fill_between(dd.index, dd.values, 0, color="firebrick", alpha=0.55)
        ax.set_title("Drawdown")
        ax.set_ylabel("Drawdown")
        ax.grid(True, alpha=0.25)
        fig.tight_layout()
        return fig

    def _plot_returns_hist(self, returns: pd.Series) -> "plt.Figure":
        fig, ax = plt.subplots(figsize=(6, 3.0), dpi=110)
        ax.hist(returns.values, bins=60, color="steelblue", alpha=0.85)
        ax.set_title("Daily return distribution")
        ax.set_xlabel("Daily return")
        ax.set_ylabel("Days")
        ax.grid(True, alpha=0.25)
        fig.tight_layout()
        return fig

    def _plot_monthly_heatmap(self, returns: pd.Series) -> "plt.Figure":
        r = returns.copy()
        if not isinstance(r.index, pd.DatetimeIndex):
            try:
                r.index = pd.to_datetime(r.index)
            except Exception:
                logger.debug(
                    "monthly heatmap: returns index not convertible to DatetimeIndex",
                    exc_info=True,
                )
        monthly = (1 + r).resample("ME").prod() - 1 if isinstance(r.index, pd.DatetimeIndex) else r
        # Pivot table: rows = year, cols = month.
        idx = monthly.index
        if isinstance(idx, pd.DatetimeIndex):
            df = pd.DataFrame(
                {"ret": monthly.values, "year": idx.year, "month": idx.month}
            )
            table = df.pivot_table(index="year", columns="month", values="ret", aggfunc="sum")
        else:
            table = pd.DataFrame()

        fig, ax = plt.subplots(figsize=(7, max(2.0, 0.45 * max(1, len(table)))), dpi=110)
        if table.empty:
            ax.text(0.5, 0.5, "no data", ha="center", va="center", transform=ax.transAxes)
        else:
            vmax = float(np.nanmax(np.abs(table.values))) or 1e-9
            im = ax.imshow(
                table.values,
                aspect="auto",
                cmap="RdYlGn",
                vmin=-vmax,
                vmax=vmax,
            )
            ax.set_xticks(range(len(table.columns)))
            ax.set_xticklabels(table.columns)
            ax.set_yticks(range(len(table.index)))
            ax.set_yticklabels(table.index)
            ax.set_title("Monthly returns heatmap")
            fig.colorbar(im, ax=ax, shrink=0.75)
        fig.tight_layout()
        return fig

    # ------------------------------------------------------------------
    # HTML
    # ------------------------------------------------------------------

    def _render_html(self, result: BacktestResult, charts: dict[str, str]) -> str:
        metric_rows = "".join(
            f"<tr><td>{k}</td><td>{_fmt_metric(k, v)}</td></tr>"
            for k, v in result.metrics.items()
        )
        img_tag = (
            lambda key, caption: (
                f'<div class="chart"><h3>{caption}</h3>'
                f'<img src="{charts[key]}" alt="{caption}" /></div>'
                if key in charts
                else ""
            )
        )
        charts_html = "".join(
            img_tag(k, c)
            for k, c in [
                ("equity", "Equity curve"),
                ("drawdown", "Drawdown"),
                ("returns_hist", "Returns distribution"),
                ("monthly_heatmap", "Monthly returns"),
            ]
        )

        closed_trades = [t for t in result.trades if t.is_closed]
        trade_count = len(closed_trades)
        avg_pnl = (
            sum(float(t.pnl) for t in closed_trades) / trade_count
            if trade_count
            else 0.0
        )

        return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Backtest report — {result.strategy_name}</title>
  <style>
    body {{ font-family: -apple-system, Helvetica, Arial, sans-serif; margin: 2em; color: #222; }}
    h1 {{ font-size: 20px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }}
    h3 {{ font-size: 14px; margin: 16px 0 6px 0; }}
    table {{ border-collapse: collapse; margin: 1em 0; }}
    th, td {{ padding: 6px 10px; border-bottom: 1px solid #eee; font-size: 13px; }}
    th {{ text-align: left; background: #fafafa; }}
    .meta {{ color: #666; font-size: 12px; }}
    .chart {{ margin: 18px 0; }}
    img {{ max-width: 860px; border: 1px solid #eee; border-radius: 4px; }}
  </style>
</head>
<body>
  <h1>Backtest report — {result.strategy_name}</h1>
  <div class="meta">
    {result.start or '?'} → {result.end or '?'} · params {json.dumps(result.params, default=_json_default)}
  </div>
  <h3>Metrics</h3>
  <table>
    <thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>{metric_rows}</tbody>
  </table>
  <h3>Trades</h3>
  <div class="meta">Closed trades: {trade_count} · Avg P&amp;L: {avg_pnl:.2f}</div>
  {charts_html}
</body>
</html>
"""


def _fmt_metric(name: str, v: Any) -> str:
    try:
        f = float(v)
    except Exception:
        return str(v)
    if "rate" in name or "ratio" in name or name in {"max_drawdown", "cagr", "alpha"}:
        return f"{f:.4f}"
    return f"{f:.4f}"


def _fig_to_datauri(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    plt.close(fig)
    data = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{data}"


__all__ = ["ReportWriter"]
