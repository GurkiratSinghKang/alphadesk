"""B.12 — Report HTML renderer (dependency-free).

Pure-Python HTML rendering for the v2 reports. Embeds a small inline
CSS so the artifact is self-contained — operators can email a single
.html file to their CPA. PDF rendering routes through WeasyPrint
when installed (``pip install weasyprint``); when not, the HTML is
the canonical artifact and the consumer can print-to-PDF.

Public API:
  - render_html(report_type, data, title, period_start, period_end,
                ai_summary=None) → str
  - render_pdf(html) → bytes  (WeasyPrint optional; raises ImportError
                                 if not installed)

Voice: editorial-quiet. Inline CSS uses near-black ink + warm gold
accents to match the v2 brand without forcing the consumer's PDF
renderer to fetch our font tokens. NOT TAX ADVICE disclaimer is
mandatory on every render.
"""
from __future__ import annotations

import html as html_module
from datetime import date
from typing import Any, Iterable


_BASE_CSS = """
  body { font-family: 'Iowan Old Style', 'Times New Roman', Georgia, serif;
         color: #1a1814; background: #f4eee2; margin: 0; padding: 32px; }
  .frame { max-width: 760px; margin: 0 auto; background: #ebe3d2;
           border: 1px solid rgba(26,24,20,0.18); padding: 32px; }
  .eyebrow { color: #7a5230; font-family: -apple-system, sans-serif;
             font-size: 11px; text-transform: uppercase;
             letter-spacing: 0.12em; font-weight: 600; margin: 0; }
  h1 { font-style: italic; font-weight: 400; font-size: 32px;
       line-height: 1.1; margin: 4px 0 12px 0; color: #1a1814; }
  h2 { font-size: 18px; font-weight: 500; margin: 32px 0 12px 0;
       border-top: 1px solid rgba(26,24,20,0.18); padding-top: 12px;
       color: #3a342a; }
  table { width: 100%; border-collapse: collapse;
          font-family: 'Menlo', monospace; font-size: 12px;
          font-variant-numeric: tabular-nums; }
  th { text-align: left; padding: 6px 8px; font-size: 10px;
       text-transform: uppercase; letter-spacing: 0.08em;
       background: #e1d6bf; color: #3a342a; font-weight: 600; }
  td { padding: 6px 8px; border-top: 1px solid rgba(26,24,20,0.10); }
  td.num { text-align: right; }
  td.profit { color: #5d6e3e; }
  td.loss { color: #a64b2a; }
  .ai-summary { font-style: italic; padding: 12px;
                background: rgba(122,82,48,0.08);
                border-left: 3px solid #7a5230;
                margin: 16px 0; line-height: 1.5; }
  .disclaimer { margin-top: 32px; padding: 12px;
                background: rgba(166,75,42,0.08);
                border: 1px solid rgba(166,75,42,0.4);
                color: #6e2f18; font-size: 11px; line-height: 1.5; }
  .meta { color: #6a6256; font-size: 11px; margin-top: 4px; }
"""


def _esc(s: Any) -> str:
    return html_module.escape(str(s) if s is not None else "—")


def _money(n: Any, signed: bool = False) -> str:
    if n is None:
        return "—"
    try:
        v = float(n)
    except (TypeError, ValueError):
        return _esc(n)
    sign = "+" if signed and v > 0 else ""
    return f"{sign}${v:,.2f}"


def _table(rows: Iterable[dict[str, Any]], columns: list[tuple[str, str, str]]) -> str:
    """Render a table from row dicts.

    `columns` is a list of (key, label, alignment) tuples.
    Alignment: "" for default left, "num" for tabular numerics,
    "profit"/"loss" for tone-coded numerics.
    """
    head = "".join(f"<th>{_esc(label)}</th>" for _, label, _ in columns)
    body_rows: list[str] = []
    for row in rows:
        cells: list[str] = []
        for key, _, align in columns:
            value = row.get(key, "—")
            cls = align
            if cls == "tone":
                try:
                    v = float(value)
                    cls = "num profit" if v > 0 else "num loss" if v < 0 else "num"
                except (TypeError, ValueError):
                    cls = "num"
            elif cls == "money_signed":
                value = _money(value, signed=True)
                cls = "num profit" if str(value).startswith("+") else "num"
                if str(value).startswith("-") or "−" in str(value):
                    cls = "num loss"
            cells.append(f'<td class="{cls}">{_esc(value)}</td>')
        body_rows.append(f"<tr>{''.join(cells)}</tr>")
    return f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(body_rows)}</tbody></table>"


def render_html(
    report_type: str,
    data: dict[str, Any],
    title: str,
    period_start: date,
    period_end: date,
    ai_summary: str | None = None,
) -> str:
    """Render a v2 report as a self-contained HTML document.

    `data` shape varies by report_type but conventional keys are:
      - ``positions``   : list[dict]  (Symbol · Qty · Cost · Mkt · Unrealized)
      - ``realized``    : list[dict]  (Ticker · Strategy · Closed · Gain · ST/LT)
      - ``strategies``  : list[dict]  (Name · Pct of P&L · MTD return)
      - ``totals``      : dict (Equity · Day P&L · MTD · YTD)
    """
    sections: list[str] = []

    if data.get("totals"):
        def _is_signed(label: str) -> bool:
            lower = label.lower()
            return any(
                token in lower
                for token in ("pnl", "p&l", "delta", "gain", "loss")
            )

        rows = [
            {"label": k, "value": _money(v, signed=_is_signed(k))}
            for k, v in data["totals"].items()
        ]
        sections.append("<h2>Summary</h2>")
        sections.append(
            _table(
                rows,
                columns=[("label", "Metric", ""), ("value", "Value", "num")],
            )
        )

    if data.get("positions"):
        sections.append("<h2>Open positions</h2>")
        sections.append(
            _table(
                data["positions"],
                columns=[
                    ("symbol", "Symbol", ""),
                    ("strategy", "Strategy", ""),
                    ("qty", "Qty", "num"),
                    ("cost", "Cost basis", "num"),
                    ("market_value", "Market value", "num"),
                    ("unrealized", "Unrealized", "money_signed"),
                ],
            )
        )

    if data.get("realized"):
        sections.append("<h2>Realized trades</h2>")
        sections.append(
            _table(
                data["realized"],
                columns=[
                    ("symbol", "Symbol", ""),
                    ("strategy", "Strategy", ""),
                    ("closed", "Closed", ""),
                    ("gain", "Gain / loss", "money_signed"),
                    ("holding", "Holding", ""),
                ],
            )
        )

    if data.get("strategies"):
        sections.append("<h2>Strategy attribution</h2>")
        sections.append(
            _table(
                data["strategies"],
                columns=[
                    ("name", "Strategy", ""),
                    ("pct", "Share of P&L", "num"),
                    ("mtd", "MTD return", "num"),
                ],
            )
        )

    summary_html = (
        f'<p class="ai-summary">{_esc(ai_summary)}</p>' if ai_summary else ""
    )
    body = "".join(sections) or "<p>No data for this period.</p>"

    return f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>{_esc(title)}</title>
<style>{_BASE_CSS}</style>
</head><body><div class="frame">
<p class="eyebrow">REPORT · {_esc(report_type.upper())}</p>
<h1>{_esc(title)}</h1>
<p class="meta">{_esc(period_start.isoformat())} → {_esc(period_end.isoformat())}</p>
{summary_html}
{body}
<p class="disclaimer"><strong>NOT TAX ADVICE.</strong> AlphaDesk reports are
informational. Confirm wash-sale + holding-period classification with your
tax professional before filing. v2 scope: equity, cash account,
exact-symbol-match. Options assignment, corporate actions, foreign
withholding, and crypto are out of scope.</p>
</div></body></html>"""


def render_pdf(html: str) -> bytes:
    """Render HTML → PDF via WeasyPrint when available.

    WeasyPrint is optional — if not installed, raises ``ImportError``
    so the caller can fall back to serving the HTML and letting the
    consumer print-to-PDF.
    """
    try:
        from weasyprint import HTML  # type: ignore
    except ImportError as exc:
        raise ImportError(
            "WeasyPrint is not installed. PDF export requires "
            "`pip install weasyprint`. Until then, serve the HTML "
            "artifact and let the consumer print-to-PDF."
        ) from exc
    return HTML(string=html).write_pdf()


__all__ = ["render_html", "render_pdf"]
