# Persona 24 — Sector Rotation Trader

**Persona:** Allocator who thinks in SPDRs (XLK/XLF/XLE…), ranks sectors by 1M/3M relative strength, tilts to regime, watches money-flow/correlation for rotation.

## What exists

- **Backend** `backend/api/routes/market_overview.py:184` — `GET /api/v1/market-overview/sectors` pulls live Alpaca snapshots for all 11 SPDR sector ETFs (XLK, XLV, XLF, XLY, XLC, XLI, XLP, XLE, XLU, XLRE, XLB). Returns `change_pct` (daily) + `ytd_pct` (from Jan-2 close). Falls back to hardcoded demo data on API failure. Sector-to-leader mapping is **static** (`XLK→NVDA`…).
- **Frontend** `frontend/src/components/dashboard/SectorTreemap.tsx` — a proper squarified treemap with daily/YTD toggle, 7-step green/red gradient, hover tooltip. Rendered at `MarketContext.tsx:120`. This is the only sector visualization.
- **Regime endpoint** `market_overview.py:275` — returns `Bull/Bear/Sideways × High/Low Vol` from SPY vs prev-close and VIXY level. `"sector_rotation": "risk-on"` is a hardcoded string in demo data, **not computed from live sector dispersion**.

## What is missing or broken

1. **No sector screener.** `backend/api/routes/screener.py:510` hardcodes `sector=None` because Alpaca's screener doesn't return sector. There is no "top 10 in XLK by 1M return" query anywhere.
2. **`sector-rotation` strategy is a labeled stub.** `backend/api/routes/strategies.py:295` advertises "rotates into top 3 sectors monthly by 1M/3M momentum" but has no runner. `frontend/src/lib/strategies.ts:110` marks `stage: "planned"`. `backend/strategies/registry.py:370` lists it planned. `audit-reports/strategy-05-regime_adaptive.md:209` calls the former active runner "a sector-rotation stub with no regime logic."
3. **No sector correlation matrix.** `StrategyCorrelation.tsx` and `RiskDashboard.tsx` correlate strategies, not sectors. No pairwise XLK/XLF/XLE return-correlation endpoint exists.
4. **No money-flow / rotation signal.** No OBV, A/D line, or sector-breadth divergence. `MarketBreadth.tsx:46` computes adv/decl across only the 11 sector tiles (N=11, trivially noisy).
5. **1M/3M lookbacks absent.** Only daily and YTD are computed. No momentum-ranking table the trader can act on.
6. **"Leader" is fake.** Treemap tooltip shows `leader_change_pct`, but backend sets it equal to the ETF's own `change_pct` (`market_overview.py:253`). The leader label is decorative.

## Verdict

1/5. The treemap looks right and the live ETF snapshot wiring works, but everything past the daily heatmap is static, planned, or synthetic. A sector rotation trader cannot rank, rotate, correlate, or time from this app today.
