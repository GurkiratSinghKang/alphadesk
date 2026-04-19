# Expert Audit — Opening Range Breakout (`orb`)

**Verdict: DISABLE for live trading. OOS Sharpe 8.34 is structurally impossible for an honest ORB on US equity ETFs — it is the fingerprint of a broken evaluation, not a tradable edge.**

---

## Mechanics vs. academic canon — mostly correct

`strategy.py` follows Zarattini–Aziz (2023) and Crabel (1990) faithfully: first-break-of-day on close, fill at the NEXT bar's open (line 384 — no look-ahead), hard stop at opposite OR extreme, mandatory 15:55 ET flat, no overnight risk. Fill-bar is correctly excluded from the exit scan (line 472, audit P0 #6). Commission 0.5 bp + slippage 2 bp on both legs. OR window ∈ {5, 15, 30} min (Zarattini / Fisher / Crabel). **This is not a mechanical bug.**

The 8.34 Sharpe comes from two structural decisions — universe and sizing — compounding in a 2-year bull OOS.

## Structural defects producing 8.34 Sharpe

**(a) Leveraged-ETF data-snooping.** OOS used `universe_profile=all_leveraged` (SPY, QQQ, **TQQQ, SPXL**). TQQQ returned ~+180%/+60% in 2023/24; SPXL ~+60%/+50%. A *long-only* (`allow_shorts=False`) ORB in a window where 3× beta compounded +200–300% is capturing leveraged beta, not a breakout edge. Zarattini's paper used 2016–2023 (bull-heavy); re-tuning on leverage in a *second* bull window double-dips the regime.

**(b) 20% notional clip inflates Sharpe by construction.** `max_notional_pct=0.20` caps size independently of `risk_per_trade=0.014`. On TQQQ with OR≈2% of price, 1.4%-equity risk sizing calls for ~70% notional; the cap clips to 20%. Clipping σ harder than μ is the canonical Sharpe-inflation lever. Max-DD −0.45% and Sortino 44.5 confirm this is not a real return distribution.

**(c) Profit factor 22.2 at 54.8% hit rate is arithmetically impossible.** PF=22 requires avg-win ≈ 20× avg-loss. OR-low stop caps losses near 1R; TP2 at 2.21× OR-range is ~2R. Honest PF should be 1.2–1.8. PF=22 implies losing trades are sized smaller than winning trades — i.e. the 20% clip asymmetrically interacts with realised volatility. This is a **bug**, not an edge.

**(d) 76% deployment on 4 leveraged symbols** = 1,337 entries / 394 active-days ≈ 3.4 entries/active-day, meaning combined exposure frequently stacks toward 80% notional on 3× ETFs ≈ **240% beta-equivalent**. Spec §3.5 even admits this is "aggressive."

**(e) Volume filter disabled.** `volume_confirm_min=0.8622` — below the 1.0 threshold the spec itself calls "effectively disabled." Tuner turned off the noise guard.

## Recommendation — DISABLE, BANNER, RE-TUNE

Honest per-trade Sharpe on SPY/QQQ ORB 2023–2024 is 0.5–0.9.

**Required fixes before live:** (1) remove TQQQ/SPXL permanently from `config.py:26` search space — restrict to `['SPY','QQQ']`; (2) remove `max_notional_pct` from clip path or raise to 100% so σ and μ clip identically; (3) set `volume_confirm_min` lower bound ≥ 1.0; (4) extend OOS to include 2022 (bear year) to defeat bull-regime snooping; (5) report **per-trade** (not per-day) Sharpe as the primary metric; (6) require `entries ≥ 250 across ≥ 2 regime periods` before any Sharpe claim is published.

**Until those fixes land, `orb` must be flagged NOT READY with a prominent warning banner in the strategy catalog and hard-disabled in the live-trading allowlist. Phase-1 OOS JSON (`phase1-orb-oos.json`) should be quarantined, not published as a representative result.**
