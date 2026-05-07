"""Curated symbol lists for earnings, options, and watchlist features.

This module is the single source of truth for ticker lists used by the
earnings screener, demo-data fallbacks, and options helpers. Edit here
and deploy. Future: migrate to a DB table if ops needs frequent online
edits without a redeploy.

Batch V (2026-05-05) externalized these constants out of
``services/earnings_screener.py``, ``services/market.py``, and
``services/options.py`` into one module so the lists have a single
source of truth and a clear edit surface.

Conventions
-----------
* All ticker symbols are upper-case ASCII.
* Module-level constants are public (no leading underscore) so callers
  can re-export them. The original modules keep aliases under their
  previous (often underscore-prefixed) names to preserve API contracts.
* "Demo" data is for fallback / fixture use only — never used on the
  hot path of a live trade.
"""
from __future__ import annotations

from typing import Literal


# ---------------------------------------------------------------------------
# Curated optionable universe (B-1)
# ---------------------------------------------------------------------------
#
# Curated universe of high-market-cap, deeply-liquid, options-heavy US names.
#
# Rules for inclusion (all three must hold):
#   1. Market cap >= $25B at the time of vetting (mega + liquid large caps).
#   2. Weekly or monthly options listed with >= 10k contract OI on the
#      front-month straddle (deep enough to absorb multi-leg fills).
#   3. Single-name business story — a Claude thesis has substance to work
#      against (not thematic ETFs or SPACs or inverse/leveraged derivatives).
#
# Explicitly excluded even if they're earnings-cycle liquid:
#   * Sub-$20B meme / retail names (GME, AMC, BB, BBIG, PTON, BYND, LCID,
#     NIO, XPEV, RIVN, AFRM, SOFI, HOOD, DKNG, MARA, RIOT, ROKU, U,
#     OKTA-ish, SNAP, PINS, DASH, FSLY, ZM, DOCU, TWLO) — spreads are wide
#     relative to premium and Claude can't consistently read the tape.
#   * Foreign ADRs with thin US options chains (kept BABA/TSM/ASML — the
#     three whose US chains are actually deep; dropped JD/PDD/NTES/BIDU).
#
# Last revision: 2026-05-05 (~140 names). Updated quarterly.
CURATED_OPTIONABLE_UNIVERSE: frozenset[str] = frozenset({
    # Mega caps (SP100 + top 30 outside) — $100B+
    "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NVDA", "TSLA",
    "BRK.B", "AVGO", "ARM", "APP", "LLY", "WMT", "JPM", "V", "XOM", "MA", "ORCL",
    "COST", "HD", "PG", "JNJ", "NFLX", "BAC", "CRM", "ABBV", "CVX",
    "KO", "MRK", "AMD", "ADBE", "PEP", "TMO", "ACN", "LIN", "CSCO",
    "MCD", "ABT", "TXN", "GE", "DHR", "WFC", "NOW", "INTU", "IBM",
    "CAT", "AMGN", "NEE", "ISRG", "PFE", "PM", "QCOM", "GS", "UNP",
    "VZ", "T", "RTX", "COP", "SPGI", "LOW", "ETN", "BLK", "HON",
    "SYK", "AXP", "BKNG", "VRTX", "C", "ELV", "DE", "TJX", "ADP",
    "GILD", "PLD", "PANW", "SCHW", "MMC", "LMT", "CB", "REGN", "MDT",
    "UBER", "BSX", "MU", "SBUX", "FI", "BX", "AMT", "KLAC", "MDLZ",
    "ADI", "CVS", "SO", "GEV", "ZTS", "CI", "MO", "CL", "DUK",
    "BMY", "WM", "ICE", "SNPS", "APH", "SHW", "PYPL", "CME",
    # Liquid large caps with deep options ($25B–$100B)
    "BA", "F", "GM", "DIS", "NKE", "SPOT", "TEAM", "ANET", "MRVL",
    "LRCX", "WDAY", "FTNT", "CDNS", "PLTR", "SNOW", "COIN", "SHOP",
    "ABNB", "CRWD", "DDOG", "SQ", "DASH", "CVNA", "RBLX", "NET",
    "MDB", "ZS",
    # Foreign ADRs with deep US options chains
    "ASML", "TSM", "BABA",
})


# ---------------------------------------------------------------------------
# Headline earnings symbols (B-2)
# ---------------------------------------------------------------------------
#
# Top mega-caps that we always want to surface on the earnings calendar
# even if FMP's calendar feed misses them. Ordered by display priority
# (earlier symbols sort first when reports share a date). The earnings
# screener uses this list both as a "guaranteed coverage" rescue path
# and as an ordering hint when many names share a print day.
HEADLINE_EARNINGS_SYMBOLS: tuple[str, ...] = (
    "MSFT", "AMZN", "GOOGL", "GOOG", "AAPL", "META", "NVDA", "TSLA",
    "ARM", "APP",
)


# ---------------------------------------------------------------------------
# BMO/AMC fallback map (A-24)
# ---------------------------------------------------------------------------
#
# Manual BMO/AMC overrides for symbols where FMP/Polygon doesn't carry a
# reliable ``announcement_when`` field. We trust the upstream value first;
# when it returns "unknown" / null we overlay this static map and only
# downgrade to "DMT" as a last resort.
#
# Last revision: 2026-05-05 (~100 entries). Add new entries via PR — only
# include symbols with a stable pattern (>= 5 of the last 6 reports same
# timing); ambiguous ones should remain absent and fall through to "DMT".
#
# Sources:
#   * Each symbol's most recent >= 6 quarters of confirmed timing on
#     Bloomberg / earningswhispers / company IR press-release headers.
BMO_AMC_FALLBACK_MAP: dict[str, Literal["BMO", "AMC"]] = {
    # Tech / semis (overwhelmingly AMC)
    "AAPL": "AMC", "MSFT": "AMC", "GOOG": "AMC", "GOOGL": "AMC",
    "AMZN": "AMC", "META": "AMC", "NVDA": "AMC", "TSLA": "AMC",
    "AMD": "AMC", "ARM": "AMC", "APP": "AMC", "NFLX": "AMC", "AVGO": "AMC", "ADBE": "AMC",
    "ORCL": "AMC", "CRM": "AMC", "NOW": "AMC", "INTU": "AMC",
    "PANW": "AMC", "FTNT": "AMC", "CRWD": "AMC", "DDOG": "AMC",
    "CDNS": "AMC", "SNPS": "AMC", "PLTR": "AMC", "SNOW": "AMC",
    "MRVL": "AMC", "MU": "AMC", "KLAC": "AMC", "LRCX": "AMC",
    "ANET": "AMC", "ADI": "AMC", "QCOM": "AMC", "TXN": "AMC",
    "ZS": "AMC", "MDB": "AMC", "NET": "AMC", "TEAM": "AMC",
    "WDAY": "AMC", "INTC": "AMC", "CSCO": "AMC", "IBM": "AMC",
    "PYPL": "AMC", "UBER": "AMC", "ABNB": "AMC", "RBLX": "AMC",
    "SHOP": "AMC", "COIN": "AMC", "DASH": "AMC", "SPOT": "AMC",
    # Banks / financials (overwhelmingly BMO)
    "JPM": "BMO", "BAC": "BMO", "WFC": "BMO", "C": "BMO",
    "GS": "BMO", "MS": "BMO", "BLK": "BMO", "SCHW": "BMO",
    "AXP": "BMO", "USB": "BMO", "PNC": "BMO", "TFC": "BMO",
    # Healthcare / pharma (mostly BMO)
    "JNJ": "BMO", "PFE": "BMO", "MRK": "BMO", "ABBV": "BMO",
    "BMY": "BMO", "LLY": "BMO", "AMGN": "BMO", "GILD": "AMC",
    "VRTX": "AMC", "REGN": "BMO", "BSX": "BMO", "MDT": "BMO",
    "TMO": "BMO", "ABT": "BMO", "DHR": "BMO", "SYK": "BMO",
    "ISRG": "AMC", "ELV": "BMO", "CI": "BMO", "CVS": "BMO",
    "ZTS": "BMO",
    # Consumer / staples / retail (mixed; document each)
    "WMT": "BMO", "COST": "AMC", "HD": "BMO", "LOW": "BMO",
    "TGT": "BMO", "TJX": "BMO", "MCD": "BMO", "SBUX": "AMC",
    "NKE": "AMC", "DIS": "AMC", "BKNG": "AMC", "CMCSA": "BMO",
    "PG": "BMO", "KO": "BMO", "PEP": "BMO", "MDLZ": "AMC",
    "PM": "BMO", "MO": "BMO", "CL": "BMO",
    # Industrials / energy / materials (mostly BMO)
    "BA": "BMO", "CAT": "BMO", "DE": "BMO", "GE": "BMO",
    "HON": "BMO", "RTX": "BMO", "LMT": "BMO", "UPS": "BMO",
    "UNP": "BMO", "F": "BMO", "GM": "BMO", "XOM": "BMO",
    "CVX": "BMO", "COP": "BMO",
    # Misc liquid
    "V": "AMC", "MA": "AMC", "FI": "BMO",
}


# ---------------------------------------------------------------------------
# Demo tradeable symbols (B-3)
# ---------------------------------------------------------------------------
#
# Demo data only — NOT used on production market-data paths. The market
# service falls back to deterministic fake quotes for symbols in this
# set when the real Polygon/Alpaca feeds are unavailable (offline dev,
# CI, demo accounts). Symbols outside this set return "no data" rather
# than a synthesized quote so we never fabricate data for unknown names.
#
# Includes S&P 500 / top US stocks plus major ETFs and indices.
DEMO_TRADEABLE_SYMBOLS: frozenset[str] = frozenset({
    # -- Mega-cap / top holdings --
    "AAPL", "ABBV", "ABT", "ACN", "ADBE", "ADI", "ADP", "ADSK", "AEP", "AIG",
    "AMAT", "AMD", "AMGN", "AMZN", "ANET", "ANSS", "AON", "APD", "APH", "AVGO",
    "AXP", "BA", "BAC", "BDX", "BKNG", "BLK", "BMY", "BRK.B", "BSX", "C",
    "CAT", "CB", "CDNS", "CEG", "CHTR", "CI", "CL", "CMCSA", "CME", "COF",
    "COP", "COST", "CRM", "CRWD", "CSCO", "CTAS", "CVS", "CVX", "D", "DASH",
    "DE", "DHR", "DIS", "DUK", "DXCM", "EA", "ECL", "EL", "EMR", "ENPH",
    "EOG", "EQR", "EW", "EXPE", "F", "FAST", "FDX", "FERG", "FI", "FICO",
    "FTNT", "GD", "GE", "GILD", "GM", "GOOG", "GOOGL", "GPN", "GS", "HCA",
    "HD", "HLT", "HON", "IBM", "ICE", "IDXX", "ILMN", "INTC", "INTU", "ISRG",
    "ITW", "JNJ", "JPM", "KDP", "KHC", "KLAC", "KO", "LIN", "LLY", "LMT",
    "LOW", "LRCX", "LULU", "MA", "MAR", "MCD", "MCHP", "MCO", "MDLZ", "MDT",
    "MET", "META", "MMC", "MMM", "MNST", "MO", "MPC", "MRVL", "MS", "MSCI",
    "MSFT", "MSI", "MU", "NEE", "NFLX", "NKE", "NOC", "NOW", "NSC", "NVDA",
    "NXPI", "ODFL", "ON", "ORCL", "ORLY", "OXY", "PANW", "PAYX", "PCAR",
    "PEP", "PFE", "PG", "PGR", "PH", "PLTR", "PM", "PNC", "PSA", "PSX",
    "PYPL", "QCOM", "REGN", "ROP", "ROST", "RTX", "SBUX", "SCHW", "SHW",
    "SLB", "SMCI", "SNPS", "SO", "SPGI", "SRE", "SYK", "SYY", "T", "TDG",
    "TGT", "TJX", "TMO", "TMUS", "TRV", "TSLA", "TT", "TXN", "UNH", "UNP",
    "UPS", "URI", "USB", "V", "VICI", "VLO", "VRSK", "VRTX", "VZ", "WBA",
    "WBD", "WDAY", "WEC", "WELL", "WFC", "WM", "WMT", "XEL", "XOM", "ZS",
    "ZTS",
    # -- Major ETFs / indices --
    "DIA", "EEM", "EFA", "GLD", "HYG", "IVV", "IWM", "LQD", "QQQ", "SLV",
    "SPY", "TLT", "VEA", "VNQ", "VOO", "VTI", "VWO", "XLB", "XLE", "XLF",
    "XLI", "XLK", "XLP", "XLU", "XLV", "XLY",
})


# ---------------------------------------------------------------------------
# Demo seed prices (B-4) — market service fallback
# ---------------------------------------------------------------------------
#
# Demo data only — NOT used in production paths. The market service uses
# these as anchor prices when synthesizing demo quotes for offline / CI
# scenarios. Values reflect mid-2025 levels and are intentionally
# stylized (round numbers) for predictable test fixtures.
DEMO_BASE_PRICES_MARKET: dict[str, float] = {
    "AAPL": 230.0, "NVDA": 140.0, "TSLA": 275.0, "MSFT": 430.0,
    "AMZN": 195.0, "META": 530.0, "GOOGL": 175.0, "SPY": 590.0,
    "AMD": 165.0, "NFLX": 680.0, "CRM": 310.0, "INTC": 32.0,
    "DIS": 115.0, "BA": 195.0, "JPM": 220.0, "V": 295.0,
    "WMT": 175.0, "PG": 170.0, "KO": 62.0, "XOM": 115.0,
}

# Demo per-symbol intraday volatility multipliers — used to scale synthetic
# bar/quote noise. Symbols outside the map use ``DEMO_DEFAULT_VOLATILITY``.
DEMO_VOLATILITY: dict[str, float] = {
    "TSLA": 0.025, "NVDA": 0.020, "AMD": 0.020, "META": 0.018,
    "NFLX": 0.018,
}
# Default demo daily vol = 1.2% (low-vol baseline). Symbol-specific overrides in DEMO_VOLATILITY.
DEMO_DEFAULT_VOLATILITY: float = 0.012


# ---------------------------------------------------------------------------
# Demo seed prices (options service) (B-4)
# ---------------------------------------------------------------------------
#
# Demo data only — NOT used in production paths. The options service uses
# its own price table (separate from the market service) tuned to a
# slightly later snapshot of underlying levels for options-pricing demos.
# Kept as a distinct table because the existing values diverge from the
# market service table; consolidating them is a future cleanup.
DEMO_BASE_PRICES_OPTIONS: dict[str, float] = {
    "AAPL": 265.0, "NVDA": 197.0, "TSLA": 390.0, "MSFT": 418.0,
    "AMZN": 249.0, "META": 672.0, "GOOGL": 339.0, "SPY": 700.0,
    "AMD": 155.0, "NFLX": 1050.0, "CRM": 310.0, "INTC": 25.0,
    "QQQ": 639.0,
}


# ---------------------------------------------------------------------------
# Demo IV table (B-5) — options service fallback
# ---------------------------------------------------------------------------
#
# Demo data only — NOT used in production paths. Per-symbol baseline IV
# for synthesizing option chains and Greeks when the upstream feed is
# unavailable. Symbols outside the map use a 0.30 default at call sites.
DEMO_BASE_IV: dict[str, float] = {
    "TSLA": 0.55, "NVDA": 0.48, "AMD": 0.45, "META": 0.38,
    "NFLX": 0.40, "COIN": 0.65, "AAPL": 0.25, "MSFT": 0.22,
    "AMZN": 0.30, "GOOGL": 0.26, "SPY": 0.15,
}


# ---------------------------------------------------------------------------
# Sector cohort map (TR-2 — tail-risk signal plumbing)
# ---------------------------------------------------------------------------
#
# For each high-edge symbol, list 4-9 related-sector peers whose intraday
# move feeds ``TailRiskSignals.sector_cohort_momentum_avg``. The recommender
# uses an aggregate cohort move > +2% as a tail-risk signal — when AI semis
# all rip together, short-vol on top of a same-sector earnings event eats
# tail risk that the chain hasn't fully priced.
#
# Inclusion rules:
#   * Peers must be in CURATED_OPTIONABLE_UNIVERSE (we'll fetch their quotes
#     via the same path; unknown tickers blow the cohort fetch budget for
#     no gain).
#   * 4-9 peers per cohort. Fewer than 4 doesn't average meaningfully;
#     more than 9 dilutes the signal and burns API budget.
#   * Symbols outside the map fall through to ``None`` — the recommender
#     treats that as no-signal and does not penalise the recommendation.
#
# Last revision: 2026-05-05 (initial seed; expand as new high-edge names
# enter the calendar).
SECTOR_COHORT: dict[str, list[str]] = {
    # AI / semiconductor cohort — the tightest co-movement on the tape.
    "AMD": ["NVDA", "AVGO", "INTC", "MU", "TSM", "QCOM", "MRVL", "KLAC"],
    "NVDA": ["AMD", "AVGO", "INTC", "MU", "TSM", "QCOM", "MRVL", "KLAC"],
    "AVGO": ["AMD", "NVDA", "INTC", "MU", "QCOM", "MRVL"],
    "INTC": ["AMD", "NVDA", "AVGO", "MU", "QCOM", "TSM"],
    "MU": ["AMD", "NVDA", "AVGO", "INTC", "QCOM", "MRVL"],
    "QCOM": ["AMD", "NVDA", "AVGO", "INTC", "MU", "MRVL"],
    "MRVL": ["AMD", "NVDA", "AVGO", "INTC", "MU", "QCOM"],
    "KLAC": ["AMD", "NVDA", "LRCX", "AMAT", "MU"],
    "LRCX": ["AMD", "NVDA", "KLAC", "AMAT", "MU"],
    "TSM": ["AMD", "NVDA", "AVGO", "INTC", "MU"],
    # Mega-cap tech (cloud / advertising / consumer-tech)
    "MSFT": ["GOOGL", "AAPL", "META", "ORCL", "CRM", "NOW"],
    "AAPL": ["MSFT", "GOOGL", "META", "AMZN"],
    "GOOGL": ["MSFT", "AAPL", "META", "AMZN"],
    "GOOG": ["MSFT", "AAPL", "META", "AMZN"],
    "META": ["MSFT", "GOOGL", "AAPL", "AMZN", "NFLX"],
    "AMZN": ["MSFT", "GOOGL", "AAPL", "META"],
    "NFLX": ["META", "GOOGL", "DIS", "AMZN"],
    "ORCL": ["MSFT", "CRM", "NOW", "INTU"],
    "CRM": ["MSFT", "ORCL", "NOW", "WDAY", "INTU"],
    "NOW": ["MSFT", "CRM", "ORCL", "WDAY"],
    "INTU": ["MSFT", "CRM", "ORCL", "ADBE"],
    "ADBE": ["MSFT", "CRM", "INTU", "NOW"],
    # Cybersecurity (high-IV, tightly correlated)
    "PANW": ["CRWD", "FTNT", "ZS", "NET"],
    "CRWD": ["PANW", "FTNT", "ZS", "NET", "DDOG"],
    "FTNT": ["PANW", "CRWD", "ZS", "NET"],
    "ZS": ["PANW", "CRWD", "FTNT", "NET"],
    # Consumer / EV (TSLA cluster)
    "TSLA": ["F", "GM", "NVDA", "RIVN", "NIO"],
    # Banks (BMO cluster — earnings beats correlate)
    "JPM": ["BAC", "WFC", "C", "GS", "MS"],
    "BAC": ["JPM", "WFC", "C", "GS", "MS"],
    "WFC": ["JPM", "BAC", "C", "GS", "MS"],
    "C": ["JPM", "BAC", "WFC", "GS", "MS"],
    "GS": ["JPM", "BAC", "WFC", "C", "MS"],
    "MS": ["JPM", "BAC", "WFC", "C", "GS"],
    # Mega-cap pharma
    "LLY": ["JNJ", "PFE", "MRK", "ABBV", "BMY"],
    "PFE": ["JNJ", "LLY", "MRK", "ABBV", "BMY"],
    "MRK": ["JNJ", "LLY", "PFE", "ABBV", "BMY"],
    "ABBV": ["JNJ", "LLY", "PFE", "MRK", "BMY"],
    # Payments / fintech
    "V": ["MA", "PYPL", "AXP", "FI"],
    "MA": ["V", "PYPL", "AXP", "FI"],
    "PYPL": ["V", "MA", "SQ", "COIN"],
    # Ride-share / on-demand
    "UBER": ["LYFT", "DASH", "ABNB"],
    # Energy mega-cap
    "XOM": ["CVX", "COP", "SLB", "EOG"],
    "CVX": ["XOM", "COP", "SLB", "EOG"],
    "COP": ["XOM", "CVX", "SLB", "EOG"],
    # Retail / consumer staples
    "WMT": ["COST", "TGT", "HD", "LOW"],
    "COST": ["WMT", "TGT", "HD"],
    "HD": ["LOW", "WMT", "COST"],
    "LOW": ["HD", "WMT", "COST"],
    # Streaming / media
    "DIS": ["NFLX", "CMCSA", "WBD"],
    # Disruptors / high-vol single-names
    "SHOP": ["SQ", "PYPL", "COIN"],
    "COIN": ["SQ", "PYPL", "SHOP", "HOOD"],
    "PLTR": ["SNOW", "MDB", "NET"],
    "SNOW": ["PLTR", "MDB", "DDOG", "NET"],
    "DDOG": ["SNOW", "MDB", "NET", "CRWD"],
    "MDB": ["SNOW", "PLTR", "DDOG"],
    "NET": ["DDOG", "MDB", "SNOW", "ZS"],
    # Semis adjacencies
    "ANET": ["AVGO", "MRVL", "CSCO"],
    "SMCI": ["AMD", "NVDA", "ANET"],
}


__all__ = [
    "CURATED_OPTIONABLE_UNIVERSE",
    "HEADLINE_EARNINGS_SYMBOLS",
    "BMO_AMC_FALLBACK_MAP",
    "DEMO_TRADEABLE_SYMBOLS",
    "DEMO_BASE_PRICES_MARKET",
    "DEMO_VOLATILITY",
    "DEMO_DEFAULT_VOLATILITY",
    "DEMO_BASE_PRICES_OPTIONS",
    "DEMO_BASE_IV",
    "SECTOR_COHORT",
]
