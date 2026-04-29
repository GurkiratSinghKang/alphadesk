export interface StrategyContent {
  thesis: string;
  edge: string;
  riskProfile: { level: "Low" | "Medium" | "High"; description: string };
  parameters: {
    rebalanceFrequency: string;
    universe: string;
    positionSizing: string;
    entryCriteria: string;
    exitCriteria: string;
    maxPositions: string;
  };
  howItWorks?: string[];
  whenToUse?: string;
  risks?: string[];
}

export const STRATEGY_CONTENT: Record<string, StrategyContent> = {
  "momentum-quality": {
    thesis:
      "A long-only cross-sectional factor strategy that combines the Jegadeesh-Titman (1993) 12-1 month momentum signal with the Piotroski (2000) F-score quality gate. On the last trading session of each month the strategy ranks a ~47-name universe of ex-Financials / ex-Utilities S&P 500 large-caps by percentile-rank of momentum and percentile-rank of F-score, requires a hard F-score floor, and holds the top 15 names equal-weighted until the next rebalance.\n\nThe quality overlay is motivated by Daniel & Moskowitz (2016) on momentum crashes: the worst left-tail momentum episodes (2009, 2022 rotation) concentrate in low-quality names, and a Piotroski gate trims them before they enter the book. Asness, Frazzini & Pedersen (2019) document that a quality-tilted composite earns materially better risk-adjusted returns than either factor alone.\n\nNo intraday logic, no stops, no take-profits. The signal is monthly; per-name stops destroy monthly-horizon signals (see Barroso & Santa-Clara 2015). The 2023-2024 walk-forward OOS Sharpe came in at 2.209 with an 8.0% max drawdown — above the 0.8 design target, but the 2023-24 regime was unusually kind to mega-cap quality momentum (NVDA / META / AAPL rally). Published long-only 12-1 momentum is a 0.6-0.9 Sharpe factor; treat the achieved OOS number as a regime-specific upside, not a long-run expectation.",
    edge:
      "Stacks two independent factor signals — Jegadeesh-Titman relative momentum and Piotroski F-score quality — where the quality gate filters the low-quality names that historically drive momentum's left tail.",
    riskProfile: {
      level: "Medium",
      description:
        "Long-only equity factor book, 15 concurrent names. No sector neutrality — 2023-24 concentrated in tech; expect 10-15% drawdowns in a sharp growth-to-value rotation. Monthly signal; no intraday protection.",
    },
    parameters: {
      rebalanceFrequency: "Monthly (last trading session of month; MOO fill next open)",
      universe:
        "47 liquid US large-caps, Financials and Utilities excluded (QMJ convention). Point-in-time F-scores via FMP filingDate filter.",
      positionSizing: "Equal-weight 1/top_n across the top names selected by composite rank",
      entryCriteria:
        "Top composite rank of 12-1 month momentum + F-score percentile, F-score >= 7 hard gate, absolute momentum >= 5.4%, no earnings within 3 days",
      exitCriteria:
        "Falls out of top-N at the next monthly rebalance. No per-name stops, no take-profits.",
      maxPositions: "15",
    },
    howItWorks: [
      "On the last trading session of each month, compute 12-1 month total return for every name in the 47-ticker universe (adjusted closes).",
      "Fetch point-in-time Piotroski F-scores from FMP (filtered by filingDate so no look-ahead); apply a hard F-score >= 7 gate and skip names with earnings in the next 3 days.",
      "Compute cross-sectional percentile ranks for momentum and F-score; blend with quality_weight ~0.32 into a composite score.",
      "Select the top 15 names; any position not in the new top 15 is closed MOO on the next session open, new entrants are sized to 1/15 equal-weight.",
      "Hold until the next monthly rebalance. No stops, no take-profits, no intra-month intervention.",
    ],
    whenToUse:
      "Designed as a core equity allocation in trending bull regimes where mega-cap leadership persists. Expect the largest drawdowns during sharp growth-to-value rotations (Jan 2022-style) and momentum unwind episodes; the quality gate softens but does not eliminate them.",
    risks: [
      "No sector neutrality at selection — the book will concentrate 2-3 sectors during persistent regimes; documented trade-off.",
      "Fixed 47-name universe does not re-screen; new S&P entrants (PLTR, etc.) and falling stars are not captured until the universe is refreshed manually.",
      "Single-split walk-forward on 2023-24 OOS — the 2.21 Sharpe carries wide confidence intervals; the published long-only factor band is 0.6-0.9.",
    ],
  },

  pead: {
    thesis:
      "A long/short event-driven equity strategy that trades Post-Earnings Announcement Drift using the Bernard & Thomas (1989, 1990) Standardized Unexpected Earnings (SUE) signal. For each quarterly report, SUE is computed as (actual EPS - consensus estimate) / sigma_surprise, where sigma_surprise is the trailing 4-8 quarter standard deviation of the forecast error. Names clearing |SUE| >= threshold are held for a 40-trading-day drift window with no stops, no take-profits, and a time-based MOC exit.\n\nLivnat & Mendenhall (2006) established that analyst-consensus SUE dominates the seasonal-random-walk variant post-1990; we use FMP consensus estimates and historical surprises. The drift window matches the Bernard-Thomas canonical 60-calendar-day window; no per-trade stops because PEAD's payoff is positive-skew and bracket orders clip the right tail.\n\nThe legacy AlphaDesk implementation had a fake SUE (|change_pct| vs a sector-average dict), a hardcoded weekday earnings calendar, an RNG-driven screener, and silently dropped every short signal (documented in prior audit). This rewrite uses real FMP earnings calendar and historical-surprise data, trades both long and short, and uses a 40-day time-stop only. 2023-2024 OOS Sharpe: 1.32, max drawdown 8.7%, 134 round-trip trades on a large-cap universe with a $5B market-cap floor.",
    edge:
      "Monetizes the underreaction to earnings surprises documented by Bernard & Thomas — prices continue to drift in the direction of a large SUE for 40 trading days post-announcement because analyst revisions and slower-moving capital take time to fully incorporate the news.",
    riskProfile: {
      level: "Medium",
      description:
        "Long/short equity with 40-day holding period; defined maximum concentration via max_concurrent_positions cap. Positions ride binary event risk — no stops means a second-quarter earnings shock inside the window can move against you.",
    },
    parameters: {
      rebalanceFrequency: "Event-driven (day after each earnings release, MOO entry)",
      universe:
        "~200 curated S&P 500 mid/large-cap names with $20M ADV, $10 price floor, and >=4 quarters of prior surprise history",
      positionSizing:
        "Equal-weight ~10% of equity per name; signed long/short based on SUE sign; book capped at max_concurrent_positions",
      entryCriteria:
        "|SUE| >= threshold (tuned to ~1.4) AND no overlapping earnings in the next 40 trading days AND universe liquidity filters pass",
      exitCriteria:
        "MOC close exactly 40 trading days after entry. No stops, no take-profits.",
      maxPositions: "15",
    },
    howItWorks: [
      "Each morning, pull the FMP earnings calendar. AMC rows from the prior session and BMO rows dated today are actionable at the next open; unknown timing falls back to the AMC anchor.",
      "Compute SUE as (actual - estimate) / trailing-quarter sigma; require at least 4 prior quarters of surprise history to size the denominator.",
      "Rank the day's surprises by |SUE| descending; take the top percent of the day by tuner selection, apply universe filters.",
      "Emit MOO entries: long if SUE > threshold, short if SUE < -threshold and shorts are enabled. Size equal-weight, sign-aware.",
      "Hold exactly 40 trading days, then MOC close. Positions with overlapping upcoming earnings are rejected at entry time.",
    ],
    whenToUse:
      "Works across market regimes because the signal is event-driven and long/short. Strongest when earnings dispersion is high and analyst consensus lags the realized surprise distribution. Expect reduced signal during the Q2 2020 post-COVID period when sigma_surprise inflated and compressed |SUE|.",
    risks: [
      "Earnings surprise data uses FMP's eventually-revised EPS, not a true point-in-time I/B/E/S snapshot; small look-ahead bias possible.",
      "40-day holding ride a second-quarter earnings event if the calendar filter misses it; overlapping-earnings filter is a best-effort gate.",
      "Single-split walk-forward — 134 round trips gives wide Sharpe CIs. Published post-2005 PEAD band is 0.3-0.7 (Chu et al. 2020); 1.32 is at the top.",
    ],
  },

  "vrp-harvesting": {
    thesis:
      "A short-volatility options strategy design that would systematically sell 16-delta SPY strangles at ~30 DTE to harvest the variance risk premium documented by Bakshi & Madan (2006) and Carr & Wu (2009) — the chronic wedge between implied volatility and subsequent realized volatility on index options. In the current SOTA shell, the backend is registered as research-only because StrategyInput does not yet carry an options chain. It computes a proxy VRP diagnostic from SPY realized volatility and emits no executable options signals.\n\nThe target production design keeps three hard gates: an entry threshold on live VRP (IV_30 - HV_20 >= 2%), a term-structure gate that refuses entries into backwardation, and a VIX/IV kill switch that flattens the book when 30-day ATM IV crosses 35%. Short-vol without tail protection is famously lethal (XIV 5-Feb-2018, Aug-2024 JPY carry), so the intended implementation pairs each strangle with a 5-delta far-OTM SPY put tail hedge at a 1:5 or 1:10 ratio.\n\nThe legacy AlphaDesk implementation issued long equity BUY signals on high-IV-rank stocks — the exact opposite of VRP harvesting. The current shell is safer: it surfaces proxy diagnostics only, marks options-chain and term-structure gates unavailable, and waits for multi-leg options-chain support before becoming autonomous.",
    edge:
      "Research-stage monitor for the volatility risk premium — the gap between implied and realized vol on SPX, positive ~81% of days over 2004-2024. The live edge requires options-chain data so the term-structure gate, tail hedge, and VIX kill switch can be enforced before any short-vol order is emitted.",
    riskProfile: {
      level: "High",
      description:
        "Research shell today; high-risk short-vol options strategy once enabled. Convex downside in gap moves must be mitigated by the kill switch + term-structure gate + tail hedge, but a true Feb-2018 intraday spike between daily closes can still produce a large mark-to-market hit.",
    },
    parameters: {
      rebalanceFrequency: "Daily diagnostics today; daily management after options-chain integration",
      universe: "SPY realized-vol proxy today; target live universe is SPY index/ETF options around 30 DTE",
      positionSizing:
        "No live sizing in research mode. Target design uses theta-target sizing with contracts scaled to target 0.3% of equity per calendar day of theta across the book",
      entryCriteria:
        "Proxy gate today: HV_20-derived IV proxy minus HV_20 >= 2% and proxy IV below 35%. Live gate will require real IV_30, term contango, and tail-hedge availability",
      exitCriteria:
        "No live exits in research mode. Target design exits at 50% max profit, 200% loss stop, 21 DTE roll, or IV_30 kill switch flat-book",
      maxPositions: "0 live; target 10 after options-chain integration",
    },
    howItWorks: [
      "Each session, read SPY daily bars and compute HV_20 plus a simple IV proxy until StrategyInput carries options-chain data.",
      "Emit diagnostics: hv_short, hv_long, iv_proxy_30, proxy VRP, kill_switch_tripped, entry_gate_open, and options_chain_available=false.",
      "Do not emit live strangle or tail-hedge signals while the options chain, term structure, and multi-leg execution contract are absent.",
      "After options-chain integration, compute real VRP = IV_30_ATM - HV_20_annualized and term structure = IV_30_ATM - IV_60_ATM.",
      "Only then sell the 16-delta strangle and buy the tail hedge, with daily management and kill-switch flattening.",
    ],
    whenToUse:
      "Best in stable, moderately-elevated VIX regimes (18-30) with contango term structure — the paying-for-insurance regime where realized vol consistently underruns implied. The kill switch is designed to stand aside in Feb-2018 / Mar-2020 / Aug-2024 events; expect extended flat-book periods during sustained backwardation.",
    risks: [
      "Tail events where VIX gaps 17->37 intraday: the kill switch triggers on the next daily close, so a single-session gap can still produce a 5-10% mark-to-market loss.",
      "Tuner may select tail_hedge_ratio=0 on a train window without a true tail event; the spec flags this as the 2018/2020/2024 failure mode and the default keeps the hedge on.",
      "Polygon Developer tier lacks historical bid/ask — synthetic ~5% spread is conservative but may under-price real-world execution friction.",
    ],
  },

  "earnings-vol-premium": {
    thesis:
      "An event-driven short-volatility strategy that sells defined-risk iron butterflies one session before a scheduled earnings release and closes at the post-event open/close the following session. The edge is the Ederington & Lee (1996) IV-ramp-then-crush pattern: front-week implied vol systematically elevates into scheduled announcements and collapses within minutes of the next open, regardless of the direction of the underlying move.\n\nThe body of the butterfly (short ATM call + short ATM put) collects a large net credit; wings (long call + long put at roughly 0.8x the implied move in the current tuned defaults) cap risk at the wing width minus the credit. Dubinsky, Johannes, Kaeck & Seeger (2019) decompose option prices into diffusive and event components and document that the event component is empirically mispriced on average; Gao, Xing & Zhang (2018) show the cross-sectional smirk richness persists around earnings.\n\nEntry is gated by a richness ratio: implied straddle move / trailing-8-quarter median realized earnings move >= 1.7555 in the checked-in tuned defaults. Below that ratio the market is not over-pricing the event by enough to cover slippage. Universe is a fixed 29-name weekly-options liquidity list (mega-cap tech + major financials + select healthcare / semis). The checked-in 2023-2024 OOS artifact reports Sharpe 1.43, max drawdown 1.9%, CAGR 11.9%, 40 OOS trades, 55% hit rate, and 1.31 profit factor. Results still use synthetic BS exit pricing, so live fills should be treated with a meaningful haircut.",
    edge:
      "Exploits the Ederington-Lee pre-earnings IV ramp and post-event crush, gated on a historical-realized-move richness filter so the position only fires when the market is over-pricing the event relative to the last 8 quarters of actual single-name earnings-day reactions.",
    riskProfile: {
      level: "High",
      description:
        "Short-vol around single-name earnings with defined max loss per trade via the wing structure. Left tail is strictly bounded at (wing_width * 100 - credit), but AI-boom outliers (NVDA, META, NFLX) regularly print 3-6 sigma earnings moves that will pin against the wings.",
    },
    parameters: {
      rebalanceFrequency: "Event-driven (T-1 MOC entry before earnings; T or T+1 open/close exit)",
      universe:
        "29-name fixed list with liquid weekly options — mega-cap tech, major banks, select healthcare/semis; underlying price >= $20",
      positionSizing:
        "Max loss per trade capped at ~2.9% of equity in the tuned defaults; contract count = floor(equity * max_loss / (wing_width*100 - credit))",
      entryCriteria:
        "Implied straddle move / 8-quarter median realized earnings move >= 1.7555, wing bid-ask < 10% of mid, timing filter currently any",
      exitCriteria:
        "One hour after the post-event open in the tuned default (or next open/close in parameter sweeps) — all four legs closed together. No intraday stops.",
      maxPositions: "1",
    },
    howItWorks: [
      "On each session, pull the FMP earnings calendar for the next session. Filter to after-market-close announcements in the 29-name universe.",
      "For each candidate, pull the Polygon chain snapshot, solve ATM straddle mid, compute implied move = straddle / underlying_close.",
      "Compute the 8-quarter median |close_T / close_T-1 - 1| from historical earnings dates. Require implied / historical >= 1.7555 in the current tuned defaults.",
      "At T-1 close, emit a single 4-leg Signal: short ATM call + short ATM put + long OTM call/put using the tuned wing-width multiple.",
      "Exit all four legs together one hour after the post-event open in the checked-in tuned defaults. Crush is captured early; holding beyond adds gamma risk.",
    ],
    whenToUse:
      "Use only when event vol is meaningfully overpriced versus that name's own earnings history. The tuned defaults are selective (max one concurrent position); widening capacity or lowering the richness filter can quickly turn this into concentrated short-gamma exposure. Historically struggled in Q1 2020 COVID vol explosion; 2020 bars are not in the reported OOS window.",
    risks: [
      "Reported Sharpe uses a synthetic BS exit-pricing model because Polygon Developer lacks historical IV and bid/ask. Real single-name weekly options will give up meaningful spread and slippage — expect a 30-50% haircut.",
      "AI-boom outliers (NVDA / META / NFLX) have produced 3-6 sigma earnings realizations that pin the trade against the wings; wing width is the guard, but 2024 losses on LLY were real.",
      "20-trial Optuna tuning — still a small parameter budget for a path-dependent options strategy. Longer runs or real historical bid/ask could shift the selected exit_timing or wing width.",
    ],
  },

  "regime-adaptive": {
    thesis:
      "A macro / tactical asset-allocation strategy that classifies the market into one of four regimes — TrendUp, MeanRevert, HighVol, Crisis — using transparent rule-based signals on SPY, its 50/200 SMAs, and a VIX proxy, then maps each regime to a pre-defined allocation across an eight-ETF universe (SPY, QQQ, EFA, IEF, TLT, GLD, BIL, VXX). Confirmation hysteresis requires the new regime label to persist for 10 consecutive trading days before the allocation flips, bounding whipsaw.\n\nThe design is close to Faber (2007) tactical asset allocation crossed with the regime-switching premise of Ang & Bekaert (2002) and Guidolin & Timmermann (2007), but deliberately rule-based rather than HMM-fitted. A prior audit flagged the legacy HMM as both lookahead-prone (full-series Viterbi smoother used at inference) and never actually plugged in; the shipped 'neutral'-hardcoded runner had no regime logic at all. Rule-based labels are transparent and do not drift with the sample.\n\nVIX is a non-tradable index; when Polygon index feed is unavailable the strategy computes a realized-vol proxy from SPY's 20-day stdev annualized. 2023-2024 OOS Sharpe: 1.62, max drawdown 7.9%, 27 fills across four regime transitions (MeanRevert -> TrendUp in Feb-Mar 2023; brief MeanRevert dip in Sep-Oct 2024). Target was 0.60; the 2023-24 regime was TrendUp-dominant and didn't stress-test the Crisis allocation.",
    edge:
      "Classifies the macro environment into four transparent rule-based regimes with a 10-day hysteresis buffer, then rebalances a diversified ETF book to a pre-defined weight vector for that regime. The edge is drawdown control across cycles, not upside capture in any single regime.",
    riskProfile: {
      level: "Medium",
      description:
        "Multi-asset ETF allocation, long-only, no leverage. Crisis regime allocation is 50% bonds / 15% gold / 35% T-bills — vulnerable to the specific 2022-style dual bear where stocks and bonds fall together.",
    },
    parameters: {
      rebalanceFrequency: "Monthly (last trading day; optionally bimonthly)",
      universe: "SPY, QQQ, EFA, IEF, TLT, GLD, BIL — 8-ETF diversified sleeve (VXX reserved at 0 weight)",
      positionSizing:
        "Pre-defined weight vector per regime (e.g. TrendUp: 40/20/10 SPY/QQQ/EFA + 15 IEF + 5 GLD + 10 BIL)",
      entryCriteria:
        "Confirmed regime label (10 consecutive days of the same instantaneous label) differs from the current allocation at a rebalance boundary",
      exitCriteria:
        "Next confirmed regime change at the next rebalance day — no intra-month intervention",
      maxPositions: "8",
    },
    howItWorks: [
      "Each bar, classify the market using SPY close vs SMA_50 / SMA_200 and the VIX proxy: Crisis if VIX > 25 AND SPY < SMA_200 (or 20 consecutive closes below SMA_200); HighVol if VIX > 25 AND SPY >= SMA_200; TrendUp if SPY > SMA_200 AND SMA_50 > SMA_200 AND VIX < 20; MeanRevert as the default.",
      "Require the new label to persist for 10 consecutive trading days before accepting it as confirmed. Hysteresis bounds whipsaw from one-bar regime flickers.",
      "On the last trading day of each month, if the confirmed label != current allocation label, close any held positions not in the new weight vector and emit MOO entries to reach the new target weights.",
      "Between rebalances the strategy does nothing — drift is allowed within the monthly cadence.",
      "If Polygon VIX feed is unavailable, fall back to SPY 20-day realized-vol proxy; thresholds are calibrated on the realized-vol scale.",
    ],
    whenToUse:
      "Designed as a portfolio anchor that trades upside for drawdown control across full cycles. Expect to underperform SPY in sustained TrendUp regimes (strategy runs at ~60% equity beta) and to protect capital in HighVol / Crisis. The 2022 dual bear (stocks + bonds both down) is the strategy's documented Achilles heel.",
    risks: [
      "Rule-based regime labels are transparent but lag at inflection points — 10-day confirmation means entry into Crisis is always ~2 weeks late (cost ~5% in Mar-2020).",
      "HighVol and Crisis allocations are 45-50% Treasuries; 2022 saw AGG/TLT down 13%/31% while SPY fell, with no safe-haven bid to exploit.",
      "Realized-vol-proxy VIX under-reads true CBOE VIX by 3-5 points in normal regimes; thresholds are calibrated but can drift if the VRP structure changes.",
    ],
  },

  "claude-alpha": {
    thesis:
      "Claude Alpha is a planned research concept, not a live backend strategy. The intended design is systematic equity selection powered by large language model reasoning: Claude would synthesize fundamentals, technical structure, sentiment, catalyst context, and options-flow clues into a scored thesis for each candidate.\n\nThe theoretical basis for the concept draws from information aggregation literature, particularly Grossman & Stiglitz (1980), which argues that prices cannot fully reflect all available information when information acquisition is costly. A model that can rapidly process earnings transcripts, management commentary, industry reports, and macro context could reduce that processing cost, especially in names with thinner analyst coverage.\n\nBefore this becomes autonomous, AlphaDesk still needs a backend strategy package, prompt/version controls, point-in-time data contracts, a replayable backtest harness, risk-manager gates, and live monitoring for model drift. Until those exist, Claude Alpha should be treated as roadmap/design material rather than an active book.",
    edge:
      "Planned edge: use Claude to synthesize unstructured fundamental, technical, sentiment, and flow data into unified stock-level views, then validate those views with replayable point-in-time backtests before any capital is allocated.",
    riskProfile: {
      level: "High",
      description:
        "Planned strategy without a backend implementation or live track record. Model opacity, prompt drift, and point-in-time data leakage are the primary risks to solve before activation.",
    },
    parameters: {
      rebalanceFrequency: "Planned weekly analysis; not active",
      universe:
        "US equities with market cap > $2B, average daily volume > $10M, and sufficient public information for multi-factor analysis",
      positionSizing:
        "Not live. Target design: conviction-weighted 1-3% per position with hard portfolio-level risk caps",
      entryCriteria:
        "Not live. Target design: Claude composite score in top quintile with explicit catalyst, thesis, uncertainty, and invalidation criteria",
      exitCriteria:
        "Not live. Target design: thesis invalidation, risk stop, or stale catalyst timeout after model-reviewed holding period",
      maxPositions: "0 live; target 15 after implementation",
    },
    howItWorks: [
      "Build a point-in-time candidate dataset first: fundamentals, transcripts, price/volume, news, estimates, and options-flow proxies.",
      "Version every prompt and model setting so a backtest can replay exactly what Claude saw at the time.",
      "Require structured output: score, catalyst, thesis, uncertainty, invalidation, and max holding period.",
      "Run the output through risk gates and a paper-trade ledger before any autonomous sizing is allowed.",
      "Only after replay + paper results are stable should the strategy graduate from planned to research or autonomous.",
    ],
    whenToUse:
      "Most promising in markets with active stock-level dispersion and abundant catalysts -- earnings seasons, sector rotations, and periods of policy uncertainty where fundamental analysis drives returns. It is not active today.",
    risks: [
      "No backend implementation or live track record yet; all performance claims must be withheld until point-in-time replay exists.",
      "Model opacity: Claude's reasoning is not fully interpretable, making it difficult to understand why specific positions are selected during drawdown periods.",
      "AI model evolution: changes to Claude's reasoning capabilities between versions could alter the strategy's characteristics without explicit calibration.",
      "Concentration risk: if Claude's analysis converges on a narrow set of themes, the portfolio may be less diversified than intended.",
    ],
  },

  "mean-reversion": {
    thesis:
      "Mean Reversion is a planned catalogue concept, not a registered backend strategy today. The live short-horizon reversal implementation is RSI-2 Mean Reversion under the rsi2-reversal strategy; this card is reserved for a future quality-conditioned mean-reversion book that would be distinct from the Connors RSI(2) system.\n\nThe intended design is a slower, fundamentally aware reversal strategy: find liquid US equities that have sold off sharply, require point-in-time evidence that balance-sheet and profitability quality remain intact, avoid imminent earnings, and exit when the dislocation normalizes or the thesis times out. That concept is plausible, but AlphaDesk does not yet ship the backend package, point-in-time fundamentals contract, backtest artifact, or live risk controls required to trade it.\n\nUntil those pieces exist, this strategy should surface as roadmap material only. Performance metrics, active positions, and order controls should remain inactive so users do not confuse it with the implemented rsi2-reversal strategy.",
    edge:
      "Planned edge: combine behavioral overreaction with a point-in-time quality gate so the system buys temporary dislocations rather than structurally impaired names. The edge still needs a replayable backtest before capital is allocated.",
    riskProfile: {
      level: "Medium",
      description:
        "Planned strategy with no live implementation. The intended risk is medium because single-name reversals can keep falling during broad selloffs, and stale fundamentals can mistake deterioration for temporary panic.",
    },
    parameters: {
      rebalanceFrequency:
        "Not live. Target design: daily screening with next-session execution after signal confirmation",
      universe:
        "Not live. Target design: liquid US large/mid caps with point-in-time fundamentals and earnings-calendar coverage",
      positionSizing:
        "Not live. Target design: equal-weight 3-5% positions with volatility and correlation caps",
      entryCriteria:
        "Not live. Target design: oversold technical setup plus point-in-time quality floor, no imminent earnings, and no structural downtrend",
      exitCriteria:
        "Not live. Target design: normalization exit, thesis timeout, or risk stop",
      maxPositions: "0 live; target 10 after implementation",
    },
    howItWorks: [
      "Do not emit live orders today; the catalogue entry is planned-only.",
      "Before implementation, define a point-in-time fundamentals provider contract so quality scores cannot leak future filings.",
      "Build a replayable backtest that separates this slower quality-reversion design from the existing rsi2-reversal backend.",
      "Add risk gates for earnings proximity, market-wide selloffs, sector clustering, and stale-fundamental data.",
      "Graduate to paper trading only after the backtest artifact and live state contract are checked in.",
    ],
    whenToUse:
      "Most promising as a future strategy in sideways or mildly volatile markets where individual stocks overreact while the broad market remains stable. It is not active today.",
    risks: [
      "No backend implementation or live track record yet; all performance claims must be withheld until point-in-time replay exists.",
      "Quality-score leakage is easy to introduce if filings are not timestamped by availability date.",
      "Correlated drawdowns can hit many reversal names at once during broad market selloffs.",
      "The catalogue already has rsi2-reversal; this future design must stay clearly differentiated to avoid duplicate exposure.",
    ],
  },

  "vcp-breakout": {
    thesis:
      "The Volatility Contraction Pattern (VCP) strategy systematizes the breakout methodology developed by Mark Minervini, a US Investing Champion, which identifies stocks completing a specific base-building pattern characterized by progressively tightening price ranges and declining volume. The VCP reflects the sequential absorption of overhead supply: each successive contraction represents a wave of selling from trapped holders at lower prices, and the narrowing of volatility signals that the available supply at current levels is being exhausted. When the stock breaks above the pivot point of the final contraction on expanding volume, it indicates a shift in the supply-demand balance that often precedes a sustained advance.\n\nThe theoretical underpinning connects to the microstructure literature on supply and demand zones and the information content of volume. Karpoff (1987) establishes the relationship between volume and price changes, while more recent work by Lo & Wang (2000) on turnover-based asset pricing models supports the thesis that declining volume during consolidation reflects genuine supply absorption rather than disinterest. The VCP pattern can be viewed as an observable manifestation of the accumulation phase described in Wyckoff methodology — sophisticated institutional buyers building positions without disrupting price, creating a coiled-spring setup where breakout above resistance encounters minimal selling pressure.\n\nRisk management is integral to the strategy's edge. Each position is initiated with a predefined 3% stop-loss from the pivot point, ensuring that failed breakouts — which occur in approximately 40-50% of setups depending on market environment — result in small, contained losses. The 10% take-profit target establishes a favorable risk-reward ratio of approximately 3:1, and partial profit-taking at intermediate levels locks in gains while allowing runners to capture extended moves. This asymmetric payoff structure means the strategy can maintain profitability with a win rate below 50%, provided the average winner materially exceeds the average loser — a characteristic confirmed by Minervini's published track record and by O'Neil's (2009) CAN SLIM research on growth stock breakouts.",
    edge:
      "Identifies the precise moment when selling pressure is exhausted in high-quality growth stocks, entering at the inflection point where supply absorption is complete and incremental demand drives price discovery into uncontested territory above resistance.",
    riskProfile: {
      level: "High",
      description:
        "Breakout strategies are inherently binary — positions either work quickly or are stopped out, resulting in frequent small losses that require psychological discipline and sufficient win-rate-to-payoff ratio to overcome.",
    },
    parameters: {
      rebalanceFrequency:
        "Daily screening with intraday entry on breakout confirmation",
      universe:
        "US equities with market cap > $1B, price > $10, average daily volume > $2M, and EPS growth > 15% YoY",
      positionSizing:
        "Position size calculated to risk 0.5-1% of portfolio NAV per trade based on entry-to-stop distance (3%)",
      entryCriteria:
        "Minimum 2 successive volatility contractions with each tightening >= 30% from prior, volume declining during base, breakout above pivot on volume >= 1.5x 50-day average, stock within 25% of 52-week high",
      exitCriteria:
        "3% stop-loss from pivot (hard stop, no discretion), 10% take-profit target with option to trail 50% of position using 10-day EMA, or close if stock re-enters base below pivot",
      maxPositions: "12",
    },
    howItWorks: [
      "Screen the US equity universe daily for stocks meeting Stage 2 uptrend criteria: above rising 50-day and 200-day moving averages, with EPS growth exceeding 15% YoY.",
      "Identify Volatility Contraction Patterns: look for at least 2 successive price contractions, each tightening 30% or more from the prior contraction, with declining volume during the base.",
      "Define the pivot point as the high of the final contraction. Monitor intraday for a breakout above the pivot on volume at least 1.5x the 50-day average.",
      "Enter on breakout confirmation with position size calculated to risk 0.5-1% of portfolio NAV based on the 3% entry-to-stop distance.",
      "Set a hard 3% stop-loss below the pivot (no discretion), a 10% take-profit target with the option to trail 50% of the position using the 10-day EMA, and close immediately if the stock re-enters the base below the pivot.",
    ],
    whenToUse:
      "VCP Breakout requires bull market conditions with clear uptrends and expanding market breadth. It works best during growth-led advances where leading stocks form constructive base patterns. The strategy is most effective in the early-to-mid stages of a market uptrend, when institutional accumulation creates the supply-absorption patterns the VCP identifies. Avoid during bear markets, late-cycle distribution phases, or periods of declining market breadth.",
    risks: [
      "High failure rate: approximately 40-50% of breakouts fail and are stopped out, requiring psychological discipline to accept frequent small losses.",
      "Market regime sensitivity: during bear markets or broad distribution phases, even perfect-looking VCPs fail because there is no institutional demand to absorb supply.",
      "False breakouts on low quality: volume confirmation helps but doesn't eliminate false breakouts driven by momentum ignition or algorithmic activity.",
      "Slippage risk: breakout entries require fast execution, and slippage above the pivot point reduces the risk-reward ratio of each trade.",
    ],
  },

  "pairs-trading": {
    thesis:
      "A cointegration-gated dollar-neutral statistical arbitrage strategy. Every ~63 trading days the strategy re-runs the Engle-Granger (1987) two-step ADF test on all within-sector pairs drawn from a 49-ticker S&P 500 mega-cap universe, keeping only pairs with ADF p < 0.05, Ornstein-Uhlenbeck half-life <= 30 days, and Hurst exponent < 0.45 (mean-reverting). Qualifying pairs are ranked by ADF p-value, and the top-N (up to 8) survivors with no ticker overlap form the active set.\n\nEntries fire on the spread's 60-day rolling z-score: at |z| >= 2.0 the strategy opens both legs simultaneously as MOO orders — one +w on the cheap leg, one -w on the rich leg, sized dollar-neutral via the OLS or Kalman hedge ratio. Exits fire at |z| < 0.5 (mean reversion), |z| > 3.5 (stop), or when a 21-day structural-break watchdog re-runs Engle-Granger on an active pair and ADF p exceeds 0.10 (force-close and retire).\n\nThe legacy AlphaDesk implementation was single-leg (shorts silently discarded, so 'market-neutral' was fiction), had no cointegration test at all, used a static hand-picked pair list with no rescreening, and held hedge ratios fixed indefinitely. This rewrite enforces a two-signal-per-pair invariant at emit time and verifies it empirically (254/254 entries, 247/248 exits in OOS). 2023-2024 OOS Sharpe: 1.23, max drawdown 4.0%, 502 trades across 64 active pairs. Published post-2006 realistic Sharpe band is 0.3-0.7 (Do & Faff 2012); 1.23 sits at the top with wide confidence intervals (~+/-0.5 on a 502-trade sample).",
    edge:
      "Dollar-neutral spread convergence between cointegrated mega-cap pairs, with a quarterly Engle-Granger rescreen and a 21-day structural-break watchdog that ejects pairs whose p-value exceeds 0.10 — the mechanism the legacy code lacked that allowed T/VZ, AMZN/WMT, XOM/CVX to silently decouple.",
    riskProfile: {
      level: "Low",
      description:
        "Long/short dollar-neutral, beta near zero by construction. Primary risk is structural-break drawdowns on pairs the quarterly rescreen doesn't catch fast enough; the 21-day watchdog and z=3.5 stop bound each event.",
    },
    parameters: {
      rebalanceFrequency: "Daily z-score monitoring with MOO entries; ~quarterly (63-day) pair rescreen and 21-day watchdog",
      universe: "49 sector-grouped S&P 500 mega-caps (Tech, Financials, Energy, Health, Consumer, Industrial) — 149 within-sector candidate pairs per rescreen",
      positionSizing: "Dollar-neutral, ~6-10% NAV per pair; max 8 concurrent pairs with no ticker overlap",
      entryCriteria:
        "|z-score| >= z_entry (~2.0-2.5), spread ADF p < 0.05, OU half-life <= 30 days, Hurst < 0.45, no active position on either leg",
      exitCriteria:
        "|z| < z_exit (~0.5-0.7) mean-revert, |z| > z_stop (~3.5-4.7) spread-break stop, or watchdog ADF p > 0.10 force-close",
      maxPositions: "8",
    },
    howItWorks: [
      "Every ~63 trading days, run Engle-Granger ADF on all 149 within-sector pairs over a 252-day formation window. Keep survivors with ADF p < 0.05, OU half-life <= 30 days, Hurst < 0.45.",
      "Rank survivors by ADF p-value ascending; admit the top 8 with no ticker overlap to the active set. Cache hedge ratios and spread statistics.",
      "Daily: compute the spread z-score from the 60-day rolling mean/std (strict no-look-ahead). For each active pair with no open position, enter at |z| >= z_entry — two coincident MOO signals, opposite signs, sized dollar-neutral via beta_t.",
      "Exit both legs together via MOC when |z| < z_exit (convergence), |z| > z_stop (spread blow-out), or the 21-day Engle-Granger watchdog reports p > 0.10 (structural break).",
      "When hedge_method='kalman', re-estimate beta each bar via a 2-D Kalman filter (Chan 2013 eq 3.5); with 'ols' the hedge ratio is fixed from the formation fit until the next rescreen.",
    ],
    whenToUse:
      "Market-neutral by construction, so the book is uncorrelated with equity beta. Works across regimes but produces the cleanest P&L in normal-volatility environments; sector-wide news (e.g. 2022 energy rally, 2023 NVDA-led tech dispersion) can decouple multiple pairs at once.",
    risks: [
      "Cost model uses the engine default (5 bps flat spread, 1% p.a. flat borrow); real pairs traders pay 5-10 bps round-trip and 1-5% borrow on HTB names. Net Sharpe impact estimated within +/-0.10.",
      "502-trade OOS sample has a 95% Sharpe CI of roughly +/-0.5; the 1.235 point estimate could plausibly be 0.7-1.7 on a replayed sample.",
      "Capacity estimate on this 49-name universe is ~$100M total AUM before edge decays (Do & Faff 2012); unsuitable for institutional scaling past ~$50M without universe expansion.",
    ],
  },

  "dividend-capture": {
    thesis:
      "The dividend capture strategy systematically harvests dividend payments by entering positions shortly before the ex-dividend date and exiting shortly after. The theoretical framework rests on the ex-dividend day pricing anomaly first documented by Elton & Gruber (1970), who showed that stock prices do not fully adjust by the dividend amount on the ex-date. Subsequent research by Frank & Jagannathan (1998) and Graham, Michaely & Roberts (2003) confirmed that the average ex-date price drop is approximately 80-90% of the dividend amount, creating a small but consistent capture opportunity when combined with the actual dividend income.\n\nThe strategy screens for stocks with dividend yields above 3%, adequate daily liquidity (> $10M ADV), positive 20-day momentum, and Piotroski F-Score of 5 or higher to avoid value traps. The momentum filter is critical -- it ensures entry into dividend stocks that are in a supportive technical environment, which increases the probability of rapid price recovery after the ex-date drop. Research by Hartzmark & Solomon (2013) demonstrates that dividend-paying stocks experience predictable demand patterns around ex-dates, with buying pressure building before the ex-date and selling pressure immediately after, creating a systematic pattern the strategy can exploit.\n\nThe quality filter (F-Score >= 5) serves to eliminate stocks that are high-yielding because of fundamental deterioration -- the classic dividend yield trap where a declining stock price inflates the yield, luring income-seeking investors into deteriorating businesses. By requiring minimum financial health, the strategy targets genuine income generators whose dividends are sustainable and whose price recovery after the ex-date is supported by solid fundamentals.",
    edge:
      "Captures reliable dividend income from high-quality stocks while momentum and quality filters minimize ex-date price drop risk, exploiting the empirically documented tendency of ex-date price adjustments to be less than the full dividend amount.",
    riskProfile: {
      level: "Low",
      description:
        "Dividend capture is inherently low-volatility, but concentrated ex-date exposure means a broad market selloff during the capture window can overwhelm the dividend income.",
    },
    parameters: {
      rebalanceFrequency: "Event-driven (triggered by upcoming ex-dividend dates)",
      universe: "US equities with annualized dividend yield > 3%, average daily volume > $10M, and Piotroski F-Score >= 5",
      positionSizing: "Equal-weight at 3-5% per position, max 5 concurrent captures",
      entryCriteria: "Enter 2-3 days before ex-dividend date with positive 20-day momentum",
      exitCriteria: "Exit 3-5 days after ex-dividend date, or on 80% price recovery, or 5% stop-loss below entry",
      maxPositions: "5",
    },
    howItWorks: [
      "Scan the dividend calendar weekly for upcoming ex-dividend dates among US equities with annualized yield above 3% and average daily volume above $10M.",
      "Apply quality screening: require Piotroski F-Score of 5 or higher to eliminate dividend yield traps (high yield from price deterioration).",
      "Confirm positive 20-day price momentum in each candidate, ensuring the stock is in a supportive technical environment for post-ex-date recovery.",
      "Enter positions 2-3 trading days before the ex-dividend date at equal weight (3-5% per position), with a maximum of 5 concurrent captures.",
      "Exit 3-5 trading days after the ex-dividend date, or earlier if 80% of the ex-date price drop has been recovered. Hard 5% stop-loss below entry protects against broader market selloffs during the capture window.",
    ],
    whenToUse:
      "Dividend capture performs best during stable-to-bullish market environments where high-quality income stocks maintain their uptrends. The strategy is most effective in low-volatility periods (VIX < 20) where the ex-date price drop is small relative to the dividend, and recovery is swift. It also works well during rate-cutting cycles when demand for dividend stocks increases. Avoid during high-volatility market environments where the ex-date drop can be amplified by broader selling pressure.",
    risks: [
      "Broad market selloff during the capture window: if the market drops sharply between entry and exit, the capital loss can far exceed the dividend captured.",
      "Dividend cut risk: even with the F-Score filter, a surprise dividend cut announced near the ex-date can cause a sharp price decline.",
      "Tax inefficiency: captured dividends are taxed as ordinary income (not qualified dividends) due to the short holding period, reducing the after-tax yield.",
      "Opportunity cost: capital tied up in dividend captures cannot be deployed in higher-returning strategies during the 5-7 day holding period.",
    ],
  },

  "sector-rotation": {
    thesis:
      "Sector rotation capitalizes on the well-documented tendency of sector performance to persist over intermediate time horizons, driven by macroeconomic regime dynamics and institutional capital flow inertia. The academic foundation rests on the business cycle framework established by Stangl, Jacobsen & Visaltanachoti (2009), who demonstrated that sector returns exhibit strong time-series momentum linked to economic cycle phases: cyclical sectors (Technology, Industrials, Consumer Discretionary) outperform during expansions, while defensive sectors (Utilities, Consumer Staples, Healthcare) outperform during contractions.\n\nBy ranking all 11 GICS sectors on a composite relative strength score (equally-weighted 1-month and 3-month returns), the strategy identifies the sectors with the strongest momentum and allocates to the top 3. This approach exploits two complementary forces: first, macro-driven institutional flows into favored sectors that create persistent outperformance as large asset managers rebalance into economic themes with multi-month horizons; second, the behavioral tendency of market participants to underweight the speed of sector rotation, creating trending opportunities as capital gradually shifts.\n\nExecution uses sector ETFs (XLK, XLV, XLF, etc.) for liquid, low-cost implementation with tight bid-ask spreads and no single-stock idiosyncratic risk. Monthly rebalancing on the first trading day balances the need for timely rotation against excessive turnover costs. Research by Moskowitz & Grinblatt (1999) on industry momentum shows that sector-level momentum effects are even stronger than individual stock momentum, with lower volatility and fewer momentum crash episodes.",
    edge:
      "Rides sector-level momentum driven by macro themes, business cycle dynamics, and institutional capital flows, exploiting the persistence of sector leadership that is stronger and less crash-prone than individual stock momentum.",
    riskProfile: {
      level: "Medium",
      description:
        "Concentrated sector bets amplify drawdowns during sector mean-reversion episodes, and monthly rebalancing can lag rapid sector rotations driven by macro shocks.",
    },
    parameters: {
      rebalanceFrequency: "Monthly (first trading day)",
      universe: "11 GICS sector ETFs (XLK, XLV, XLF, XLE, XLI, XLY, XLP, XLU, XLB, XLRE, XLC)",
      positionSizing: "Equal-weight 33% per selected sector across top 3 sectors",
      entryCriteria: "Top 3 sectors by composite 1-month + 3-month relative strength ranking",
      exitCriteria: "Sector drops below 10th percentile rank at monthly rebalance, or replaced by higher-ranked sector",
      maxPositions: "3",
    },
    howItWorks: [
      "On the first trading day of each month, compute the 1-month and 3-month total returns for all 11 GICS sector ETFs.",
      "Calculate a composite relative strength score as the equally-weighted average of the two return horizons, ranking all sectors from strongest to weakest.",
      "Allocate the portfolio equally (33% each) to the top 3 ranked sectors using sector ETFs for liquid, low-cost execution.",
      "At the next monthly rebalance, re-rank sectors and replace any that have dropped below the 10th percentile rank or are no longer in the top 3.",
      "Maintain full investment -- no cash buffer. If a sector is replaced, the capital is immediately reallocated to the new top-3 sector.",
    ],
    whenToUse:
      "Sector rotation excels during sustained economic trends where sector leadership persists for multiple months -- early-to-mid business cycle expansions (overweight cyclicals), late-cycle tightening (overweight defensives), and recovery phases (overweight rate-sensitive sectors). It adds the most value when macro themes are clear and institutional flows are directional. Avoid during rapid, unpredictable sector rotations (e.g., tariff whiplash, sudden policy reversals) where monthly rebalancing is too slow to capture the shift.",
    risks: [
      "Whipsaw: monthly rebalancing can lag rapid sector rotations driven by macro shocks, causing the strategy to overweight lagging sectors after a sudden regime change.",
      "Concentration risk: 33% per sector is aggressive; a sharp reversal in a single sector can cause outsized portfolio-level drawdowns.",
      "Momentum crash: during market stress, the highest-momentum sectors can reverse violently (e.g., Technology in Q4 2018), and the strategy will be fully invested at the pivot.",
      "Missing the bottom: during bear market recoveries, the strategy will still be in defensive sectors while recovery sectors rally, potentially missing the initial bounce.",
    ],
  },

  "gap-fill": {
    thesis:
      "The gap fill strategy exploits the well-documented tendency of overnight price gaps in liquid large-cap stocks to partially or fully revert during the first 30-90 minutes of regular trading. Research by Branch & Ma (2012) demonstrated that gap-fill rates exceed 70% for gaps between 1-3% in liquid S&P 500 stocks, with the fill typically occurring within the first hour of trading. The edge arises from the microstructure of the opening auction: overnight news, pre-market algorithmic activity, and thin pre-market liquidity create exaggerated price dislocations that the full regular-session order book rapidly normalizes.\n\nThe strategy enters at the market open in the direction of the fill -- shorting gap-ups and buying gap-downs -- targeting 50-80% gap closure as the profit target. Position sizing is inversely scaled with gap magnitude: larger gaps receive smaller positions because they are more likely to be driven by genuine catalysts (earnings surprises, M&A announcements) that justify the price change. The VIX filter (< 25) excludes high-volatility environments where gaps tend to extend rather than fill, as documented by Cooper, Cliff & Gulen (2008) in their study of market open return predictability.\n\nAll positions are closed by 11:00 AM ET regardless of profit or loss, eliminating overnight risk entirely. This strict time stop ensures the strategy remains purely intraday, with no exposure to the gap risk it is designed to exploit. The strategy is currently paused as it requires a more sophisticated catalyst-screening layer to distinguish fillable gaps (driven by noise and pre-market overreaction) from genuine gaps (driven by material news events).",
    edge:
      "Fades exaggerated overnight gaps in liquid stocks, profiting from the reliable tendency of pre-market dislocations to revert as the full regular-session order book absorbs the overnight information asymmetry.",
    riskProfile: {
      level: "High",
      description:
        "Intraday gap fading is high-frequency and high-volatility; gaps driven by genuine catalysts (earnings, M&A) can extend violently, and the VIX filter may lag sudden regime shifts.",
    },
    parameters: {
      rebalanceFrequency: "Intraday (9:30 AM ET entry, close by 11:00 AM ET)",
      universe: "S&P 500 stocks with average daily volume > $50M and overnight gap > 1% from previous close",
      positionSizing: "1-2% of portfolio NAV per trade, scaled inversely with gap size",
      entryCriteria: "Gap > 1% from previous close at market open, VIX < 25, no pending earnings or major news catalyst",
      exitCriteria: "50-80% of gap filled (target), stop-loss at gap extreme (100% gap), or time stop at 11:00 AM ET",
      maxPositions: "3",
    },
    howItWorks: [
      "Pre-market (before 9:30 AM ET), scan S&P 500 stocks for overnight gaps exceeding 1% from the previous close, using the pre-market indicative price.",
      "Filter out stocks with pending earnings, recent M&A activity, or other material news catalysts that would justify the gap (these gaps are less likely to fill).",
      "Confirm VIX is below 25 -- in high-volatility regimes, gaps tend to extend rather than fill.",
      "At market open (9:30 AM), enter in the direction of the fill: short gap-up stocks, buy gap-down stocks. Size inversely with gap magnitude (1-2% of NAV).",
      "Close positions when 50-80% of the gap is filled (profit target), at the gap extreme (stop-loss), or at 11:00 AM ET (time stop) -- whichever comes first. All positions are flat by mid-morning.",
    ],
    whenToUse:
      "Gap fill works best during normal-volatility market environments (VIX 12-22) where overnight gaps are driven by noise, pre-market algorithmic activity, or minor news rather than genuine catalysts. The strategy excels on days with low macro event risk (no FOMC, no CPI) where the opening auction normalizes overnight dislocations efficiently. Currently paused pending implementation of a catalyst-screening layer.",
    risks: [
      "Catalyst-driven gaps: gaps caused by genuine material events (earnings, M&A, FDA rulings) can extend violently rather than fill, leading to rapid stop-loss hits.",
      "VIX regime lag: the VIX filter may not capture sudden intraday volatility spikes that cause gap extensions after the strategy has entered.",
      "Execution risk: requires fast, reliable execution at the opening bell; slippage at the open can significantly erode the tight risk-reward of gap fill trades.",
      "Low Sharpe intraday: each individual trade has a small expected profit, requiring high win rates and disciplined execution to generate meaningful returns after commissions.",
    ],
  },

  "manual-discretionary": {
    thesis:
      "The Manual/Discretionary strategy bucket captures all trades placed directly on Alpaca outside of the automated pipeline. These positions represent personal conviction trades, hedging adjustments, or opportunistic entries that don't fit neatly into any systematic strategy framework. Every trade placed in this bucket receives a post-execution review from Claude, providing objective analysis of what went right or wrong.\n\nThe rationale for tracking discretionary trades alongside systematic strategies is twofold. First, it provides complete portfolio attribution -- every dollar of P&L is assigned to a strategy, preventing orphaned positions from distorting the performance of automated strategies. Second, by logging discretionary trades with the same rigor as systematic entries, the trader builds a decision journal that can be analyzed for behavioral patterns: overtrading tendencies, timing biases, position sizing errors, and conviction calibration.\n\nResearch on discretionary trading performance by Barber & Odean (2000, 2001) consistently shows that individual traders underperform due to behavioral biases including overconfidence, the disposition effect (holding losers too long, selling winners too early), and excessive trading frequency. By subjecting each discretionary trade to Claude's analytical review, the strategy aims to mitigate these biases through structured post-trade analysis.",
    edge:
      "Combines human intuition and market awareness with AI-powered post-trade analysis, creating a feedback loop that systematically identifies and corrects behavioral trading biases over time.",
    riskProfile: {
      level: "High",
      description:
        "Discretionary trades carry higher risk than systematic strategies because they lack predefined entry/exit criteria and are subject to behavioral biases that can lead to oversized positions or poor timing.",
    },
    parameters: {
      rebalanceFrequency: "Ad-hoc (trader-initiated)",
      universe: "Any US equity available on Alpaca (no restrictions)",
      positionSizing: "Trader discretion, recommended max 5% per position",
      entryCriteria: "Trader conviction (no systematic filter)",
      exitCriteria: "Trader discretion + Claude post-trade review recommendations",
      maxPositions: "No limit (portfolio-level risk controls apply)",
    },
    howItWorks: [
      "Place trades directly on Alpaca through the AlphaDesk trade interface or the Alpaca dashboard. Orders are routed to the broker immediately.",
      "AlphaDesk detects untracked Alpaca positions during its periodic sync and automatically creates ledger entries with the 'manual' strategy tag.",
      "Claude reviews each position periodically, analyzing entry timing, fundamental context, technical setup, and prevailing sentiment at time of entry.",
      "On position close, Claude generates a post-trade report evaluating the quality of the trade decision, identifying behavioral patterns, and suggesting improvements.",
      "All discretionary trades contribute to the portfolio-level performance dashboard, providing complete attribution of every dollar of P&L.",
    ],
    whenToUse:
      "Use for trades driven by personal conviction, breaking news events, hedging needs, or opportunistic entries that don't fit systematic strategy criteria. Best used sparingly -- research shows that traders who trade less frequently outperform those who overtrade. Each discretionary trade should have an explicit thesis that can be evaluated after the fact.",
    risks: [
      "Behavioral biases: overconfidence, disposition effect, anchoring, and recency bias all disproportionately affect discretionary trading decisions.",
      "Lack of predefined exits: without systematic stop-losses and targets, losses can compound and winners can be cut short.",
      "Portfolio concentration: discretionary trades may inadvertently cluster in correlated sectors or themes, creating hidden concentration risk.",
      "Performance drag: academic evidence consistently shows that discretionary trading, on average, underperforms systematic approaches due to emotional decision-making.",
    ],
  },

  // ─── Technical Analysis Strategies ─────────────────────────

  "ts-momentum": {
    thesis:
      "A multi-asset time-series momentum (TSMOM) strategy following Moskowitz, Ooi & Pedersen (2012). For each ETF in a 6-11 ticker universe spanning US / ex-US / emerging equity, Treasuries, credit, gold, commodities, USD, and REITs, the strategy measures the sign of the 12-month own return and goes long assets with positive momentum (short if shorts are enabled). Per-asset inverse-volatility weights target a constant risk contribution, and the whole book is scaled to a ~13% annualized vol target.\n\nHurst, Ooi & Pedersen (2013) show the core futures-TSMOM signal survives the substitution of liquid ETF proxies at the cost of ~0.4 Sharpe (imperfect hedges on DBC, GLD, UUP). An optional drawdown de-lever halves the next month's gross notional if portfolio drawdown exceeds the threshold, approximating the vol-scaling AQR / Man AHL production convention.\n\nThe legacy AlphaDesk implementation was long-only, single-asset-class, with a 24-entry hardcoded VOL_MAP and a dimensionally-wrong sizing formula; it also fought its own signal with a 20-day time stop and tightening trailing ATR. This rewrite is correctly sized, multi-asset, signed target weights, and stops-free — monthly signals only, with intra-month prices ignored. 2023-2024 OOS Sharpe: 1.52, max drawdown 4.4%, CAGR 8.1%, bimonthly rebalance, shorts off (tuner choice on a bull window).",
    edge:
      "Sign-of-12-month-return momentum earns the trend risk premium across loosely-correlated asset classes, and per-asset inverse-vol weighting ensures no single leg dominates. Provides crisis-alpha-shaped convexity when all assets trend together.",
    riskProfile: {
      level: "Low",
      description:
        "Diversified multi-asset book, vol-targeted at ~13% annualized with per-asset caps (max 28% per leg). No intraday stops; drawdown de-lever halves exposure on a 10-18% portfolio drawdown.",
    },
    parameters: {
      rebalanceFrequency: "Bimonthly (tuner-selected; monthly available)",
      universe:
        "11 liquid ETFs — SPY, EFA, EEM, IEF, TLT, LQD, HYG, GLD, DBC, UUP, VNQ (US/intl eq, Treasuries, credit, gold, commodities, USD, REITs)",
      positionSizing:
        "Per-asset inverse-vol weight w_i = target_vol / sigma_i, capped at 28% per leg; normalized to gross 1.0, scaled by drawdown de-lever",
      entryCriteria:
        "Sign of 12-month own return (+1 long / -1 short if enabled / 0 otherwise); rebalance day only",
      exitCriteria:
        "Sign flip or asset drops out of universe at next rebalance — close via MOO. No intra-month stops.",
      maxPositions: "11",
    },
    howItWorks: [
      "On each rebalance day (last trading day of month, bimonthly per tuner), compute each ETF's 12-month return from adjusted closes.",
      "Compute realized volatility over a 60-90 day window; floor at 5% annualized to prevent explosive sizing on ultra-low-vol legs like IEF.",
      "Direction = sign(12m return); raw weight = dir * (target_vol / sigma). Normalize gross weights to 1.0 with the per-asset cap applied.",
      "Apply drawdown de-lever: if portfolio drawdown from peak exceeds the threshold (~18%), halve the next month's gross notional.",
      "Emit signed MOO target weights for each asset; close positions whose sign flipped or that dropped out of the universe. No intra-month intervention.",
    ],
    whenToUse:
      "Works as a diversifier across regimes because of the multi-asset universe; the 2023 SG Trend Index -4.2% demonstrates TSMOM can still have bad years when rates and carry reverse together. Best Sharpe in sustained directional environments; worst in trendless chop (2015, 2023).",
    risks: [
      "ETF tracking error on commodity / FX legs (DBC, GLD, UUP) costs ~0.3-0.5 Sharpe vs a true futures TSMOM per Hurst/Ooi/Pedersen 2013.",
      "Borrow costs on shorts (when enabled) use a generic 1% p.a. flat rate; symbol-specific borrow modelling is deferred to a future wave.",
      "Rebalance-day data availability: if a single ETF has no bar that day, its signal is dropped and the rest of the book is normalized without it — no makeup trade is queued.",
    ],
  },

  "rsi2-reversal": {
    thesis:
      "A short-horizon long-only mean-reversion strategy on US large-cap equities following Connors & Alvarez (2009). The textbook rule — RSI(2) < threshold in a name trading above its 200-day SMA — is augmented with a ConnorsRSI OR-gate (the 3-component blend of price RSI, streak RSI, and 100-bar percent-rank per Connors Research 2013), a volume-surge confirmation on the entry bar, and a SPY-RSI(2) systemic regime gate that keeps the strategy out of broad panic selloffs.\n\nA prior audit flagged three fatal bugs in the legacy runner: a demo-data universe (not real large-caps), a missing manage() hook (so the advertised RSI > 70 exit never fired), and a swing-low stop wired to the same panic regime where gap risk is highest. This rewrite adds explicit manage()-based exits (RSI profit-take, SMA-5 crossover, swing-low stop, time stop), a liquidity-screened 3-ETF + ~55 S&P 100 universe with a 90-day $50M ADV floor, and a 3-day pre-earnings skip when an earnings calendar is wired.\n\nAvellaneda & Lee (2010) and Kakushadze (2015) document post-2015 decay of single-name short-horizon reversal — the realistic Sharpe band is 0.4-0.7, well below Connors' 2009 in-sample 1.3-1.6 era. 2023-2024 OOS Sharpe: 1.88, max drawdown 1.91%, 259 round-trip trades, hit rate 59%. The Sharpe is well above the 0.6 target, achieved with a tighter raw-RSI entry (6.55 vs textbook 10), a higher SPY regime floor (15.8 vs 10), and a shorter take-profit SMA (3 vs 5) — the tuner's post-2015-decay adjustments.",
    edge:
      "Provides short-duration liquidity during panic selloffs in large-caps that are structurally in uptrends. The SPY RSI(2) regime gate is the difference between the 2009 Connors results and a 2015+ version that still works: it keeps the book out during broad-market washouts where single-name signals fail.",
    riskProfile: {
      level: "Medium",
      description:
        "Long-only, short holding period (mean ~3 trading days). ~88% peak gross exposure with 8 concurrent names at ~11% each. Swing-low stop + time stop + SPY regime floor bound tail loss; gap-down risk on earnings-adjacent names is the residual.",
    },
    parameters: {
      rebalanceFrequency: "Daily scan; MOO entries, MOC exits",
      universe:
        "SPY + QQQ + IWM core ETFs and ~55 S&P 100 large-caps that clear a 90-day $50M dollar-ADV floor",
      positionSizing: "~11% allocation per trade, equal-weight, up to 8 concurrent",
      entryCriteria:
        "Close > 200-SMA AND (RSI(3) < 6.55 OR ConnorsRSI < 20.67) AND volume >= 1.73x 20-day avg AND SPY RSI(2) > 15.8 AND no earnings in next 3 days",
      exitCriteria:
        "RSI(3) > 59.8 profit-take OR close > 3-SMA OR close <= swing-low stop OR 10 trading-day time stop",
      maxPositions: "8",
    },
    howItWorks: [
      "Screen the universe at each bar: skip all entries when SPY RSI(2) <= 15.8 (systemic regime gate).",
      "For each remaining name above its 200-day SMA, check the oscillator OR-gate: RSI(3) < 6.55 OR ConnorsRSI < 20.67.",
      "Confirm with a volume surge (>= 1.73x 20-day mean volume) and no scheduled earnings in the next 3 sessions.",
      "Rank eligible candidates by ConnorsRSI ascending (most oversold first); emit MOO entries up to 8 concurrent longs, sized ~11% of equity each.",
      "Manage each bar: close MOC on RSI(3) > 59.8 profit-take, close > 3-SMA, swing-low stop breach, or 10-day time stop. No per-trade take-profit beyond the RSI/SMA exits.",
    ],
    whenToUse:
      "Designed for brief pullbacks in sustained bull markets with stable macro backdrops. The 200-SMA filter and SPY regime gate keep the book flat during extended bear markets; expect quiet periods (few entries) during 2022-style regimes.",
    risks: [
      "Earnings provider not wired in the tuner run; the 3-day pre-earnings skip was tested but not active in the reported OOS Sharpe.",
      "Legacy short side is intentionally dropped — single-name short reversal has been unprofitable since ~2013 because equity drift overwhelms the signal.",
      "Fixed ~55-name seed list doesn't capture new S&P 100 entrants (PLTR, MSTR) or drop falling stars until manually refreshed.",
    ],
  },

  "dual-momentum": {
    thesis:
      "Antonacci's (2014) Global Equities Momentum (GEM): a single-asset monthly rotation across US equity, ex-US equity, and aggregate bonds, driven jointly by absolute momentum (12-month equity return > T-bill return) and relative momentum (US-equity 12m vs ex-US 12m). The portfolio holds 100% of one sleeve at a time — the winning equity index if absolute momentum is positive, aggregate bonds if not.\n\nA prior audit found the legacy AlphaDesk 'dual_momentum' was actually a 30-name cross-sectional Jegadeesh-Titman screener with a SPY on/off gate — not GEM at all. It omitted the bond fallback (the defining feature), the T-bill excess-return comparator (used nominal > 0), the ex-US equity sleeve, and layered 8% stops + 20% take-profits that destroy a 12-month signal (flagged in prior audit). This rewrite restores the textbook rules: monthly rebalance on the last trading day, 100% notional in one sleeve, no stops, no take-profits, no sizing games.\n\nAntonacci's 1974-2013 backtest reports CAGR ~15.7%, Sharpe ~0.87, max-DD ~17.8% vs SPY ~51%. The 2022 dual-bear (AGG -13%, SPY -18%) is a documented failure mode — the bond fallback offers no hiding place when both legs fall together. 2023-2024 OOS with textbook defaults: Sharpe 1.26, max DD 10%, CAGR 14%. Best tuned (VOO/VEU -> SPY/EFA/EEM relative universe, 126/252 composite lookback): Sharpe 1.34. SPY buy-and-hold over the same window scored Sharpe 1.82 — DM's structural edge is drawdown control across full cycles, not upside capture in a strong narrow bull.",
    edge:
      "Combines absolute (time-series) and relative (cross-sectional) momentum: the absolute gate moves to bonds when equities are in a 12-month drawdown; the relative gate picks the winning equity region when equities are up. Both gates are independently robust signals.",
    riskProfile: {
      level: "Medium",
      description:
        "Single-asset 100% notional with ~12 decisions per year. No intra-month stops. 2022-style dual-bear (both stocks and bonds down) is the specific regime the strategy cannot hedge.",
    },
    parameters: {
      rebalanceFrequency: "Monthly (last trading session; bimonthly available)",
      universe: "VOO (US equity), VEU (ex-US equity), AGG (bond fallback), BIL (T-bill proxy for excess-return comparator)",
      positionSizing: "100% of equity in one sleeve; MOO fills at the next session open",
      entryCriteria:
        "Absolute: r_eq(12m) - r_bil(12m) > floor. Relative: pick max(r_voo(12m), r_veu(12m)). If absolute fails, hold bond fallback.",
      exitCriteria:
        "Next monthly rebalance — flip sleeve if the winner changes. No per-trade stops, no take-profits.",
      maxPositions: "1",
    },
    howItWorks: [
      "On the last trading session of each month, compute 12-month total returns for VOO, VEU, and BIL.",
      "Absolute-momentum test: if VOO_12m - BIL_12m <= floor (default 0), set target = AGG (bond fallback).",
      "Otherwise relative-momentum test: set target = argmax(VOO_12m, VEU_12m).",
      "manage() closes any held position that differs from the target via MOO. generate_signals() emits a single target_weight=1.0 MOO entry for the target symbol.",
      "Hold 100% of the target sleeve until the next monthly rebalance. Between rebalance days the strategy does nothing.",
    ],
    whenToUse:
      "Best drawdown control over full cycles — the bond fallback avoided the 2008 and 2020 equity drawdowns. Expect to underperform SPY buy-and-hold in narrow, sustained bull markets (2023-2024) and expect the strategy's worst year to be a 2022-style dual bear.",
    risks: [
      "2022-style dual-bear: AGG -13% and SPY -18% in the same year left no hiding place; the IS 2022 Sharpe was 0.36 with 34% drawdown.",
      "Lookback-based signals lag at inflection points — late re-entry after March 2009 bottom and slow exit before the March 2020 COVID low both cost alpha.",
      "Small trade count (~12 decisions/year) means the Sharpe has wide confidence intervals — +/-0.3 over a 6-year window per Antonacci's own sensitivity analysis.",
    ],
  },

  "pairs-stat-arb": {
    thesis:
      "A cointegration-gated dollar-neutral statistical arbitrage strategy. Every ~63 trading days the strategy re-runs the Engle-Granger (1987) two-step ADF test on all within-sector pairs drawn from a 49-ticker S&P 500 mega-cap universe, keeping only pairs with ADF p < 0.05, Ornstein-Uhlenbeck half-life <= 30 days, and Hurst exponent < 0.45. Qualifying pairs are ranked by ADF p-value; the top-N (up to 8) survivors with no ticker overlap form the active set.\n\nEntries fire at |z-score| >= 2.0 on the 60-day rolling spread, with both legs emitted as coincident MOO orders sized dollar-neutral via the OLS or Kalman hedge ratio. Exits fire at |z| < 0.5, |z| > 3.5 stop, or a 21-day Engle-Granger watchdog that retires pairs whose cointegration p-value decays past 0.10. 2023-2024 OOS Sharpe: 1.23, 502 trades; published post-2006 realistic band is 0.3-0.7.",
    edge:
      "Dollar-neutral spread convergence between cointegrated pairs with a quarterly rescreen and a 21-day structural-break watchdog — the mechanism the legacy code lacked that allowed decoupled mega-cap pairs to accumulate silent losses.",
    riskProfile: {
      level: "Low",
      description:
        "Long/short dollar-neutral, beta near zero. Primary risk is structural-break drawdowns on pairs the watchdog doesn't catch fast enough.",
    },
    parameters: {
      rebalanceFrequency: "Daily z-score monitoring; ~63-day rescreen; 21-day watchdog",
      universe: "49 sector-grouped S&P 500 mega-caps across Tech, Financials, Energy, Health, Consumer, Industrial",
      positionSizing: "Dollar-neutral, ~6-10% NAV per pair; up to 8 concurrent pairs with distinct tickers",
      entryCriteria: "Engle-Granger ADF p < 0.05, OU half-life <= 30d, Hurst < 0.45, |z-score| >= 2.0",
      exitCriteria: "|z| < 0.5 (mean revert), |z| > 3.5 (stop), or watchdog ADF p > 0.10 (break)",
      maxPositions: "8",
    },
    howItWorks: [
      "Every ~63 trading days, Engle-Granger ADF test on all within-sector pairs over 252-day formation. Admit survivors with p < 0.05, OU half-life <= 30d, Hurst < 0.45.",
      "Daily: compute 60-day rolling z-score on each active pair. Enter both legs at |z| >= 2.0 — two coincident MOO signals, opposite signs, sized dollar-neutral via hedge ratio.",
      "Exit both legs together via MOC when |z| < 0.5 (convergence), |z| > 3.5 (spread blow-out), or the 21-day watchdog reports ADF p > 0.10.",
      "OLS hedge ratio is fixed between rescreens; Kalman hedge ratio updates each bar via Chan 2013 eq 3.5.",
      "Enforce two-leg invariant at emit time — every entry/exit adds/removes exactly two coincident signals.",
    ],
    whenToUse:
      "Market-neutral so uncorrelated with equity beta. Cleanest P&L in normal-volatility environments; sector-wide news (2022 energy rally, 2023 NVDA-led tech dispersion) can decouple multiple pairs at once.",
    risks: [
      "Cost model is the engine default (5 bps flat spread, 1% flat borrow); real costs are 5-10 bps round-trip and 1-5% borrow on HTB names — net Sharpe impact estimated within +/-0.10.",
      "502-trade OOS has a 95% Sharpe CI of ~+/-0.5; the 1.23 point estimate could plausibly be 0.7-1.7 on a replayed sample.",
      "Capacity on this 49-name universe estimated at ~$100M total AUM before edge decays (Do & Faff 2012).",
    ],
  },

  "kama-breakout": {
    thesis:
      "A long-only adaptive trend-breakout strategy combining Kaufman's (1995) KAMA with a Donchian N-day high breakout, a Kaufman Efficiency Ratio gate, and a long-term SMA trend filter. The ER gate (default 0.39) is the specific fix the audit flagged: the legacy code computed ER and logged it but never gated on it, so every micro-rally past the Donchian high fired a signal. With the gate, only moves where a sufficient fraction of the net period return is coming from the direction of travel fire.\n\nSizing follows the Turtle convention (Faith 2007) — 1% of equity risked per trade, with shares = (risk * equity) / stop_distance where stop_distance = 3.63 * ATR (the tuner-selected chandelier multiplier). The legacy code wrote shares = 0.01 * equity / ATR and placed a 3-ATR stop, so realized risk per trade was 3%. This rewrite uses the stop distance explicitly. Exits are chandelier trailing stop OR KAMA crossunder; no hard take-profit (capping upside destroys trend-following skew).\n\n2023-2024 OOS on a 14-ETF universe (broad market + sector ETFs): Sharpe 1.685, max DD 3.43%, CAGR 9.38%, 85.7% hit rate across 7 round-trip trades. 7 trades over 2 years is intentional — the ER + trend-filter gates are restrictive by design — but the Sharpe CI is wide on a 7-sample population. Expect higher drawdowns in a full 5-year window containing bear trends.",
    edge:
      "KAMA's efficiency ratio gates entries to genuinely trending regimes, cutting whipsaw trade count ~50% vs a pure Donchian breakout. The 200-SMA trend filter (tuner picked 100) is the single biggest Sharpe contributor per the audit.",
    riskProfile: {
      level: "Medium",
      description:
        "Long-only trend-following; up to 5 concurrent positions at ~11% each. Turtle 1% risk-per-trade correctly sized. Trend filter keeps the book in cash during sustained bear markets.",
    },
    parameters: {
      rebalanceFrequency: "Daily scan; MOO entries on breakout confirmation",
      universe: "14 ETFs — SPY, QQQ, IWM + 11 GICS sector ETFs (XLE, XLF, XLK, XLV, XLI, XLP, XLU, XLY, XLB, XLRE, XLC)",
      positionSizing: "Turtle 1% risk per trade: shares = (0.0102 * equity) / (3.63 * ATR); max ~11% per position",
      entryCriteria:
        "Close > KAMA AND close > Donchian_upper(30) AND ER >= 0.39 AND close > SMA_100 (rising) AND no earnings +/-2 days",
      exitCriteria: "Chandelier stop (highest high - 3.63 * ATR, ratcheting) OR close < KAMA",
      maxPositions: "5",
    },
    howItWorks: [
      "Compute KAMA with ER period 10, fast 3, slow 20 (tuner-selected; textbook Kaufman fast=2, slow=30).",
      "At each bar, gate on: close > KAMA AND close > Donchian upper(30) excluding today AND ER >= 0.39 AND close > rising SMA_100 AND no scheduled earnings within 2 days.",
      "Compute ATR(22) and size shares = (0.0102 * equity) / (3.63 * ATR). Cap position notional at ~11% of equity.",
      "Manage each bar: ratchet the chandelier stop up to max(prior stop, highest_high_22 - 3.63 * ATR). Exit on stop hit or KAMA crossunder. No hard take-profit.",
      "Pyramid at +1 ATR in favor: add a half-size unit if room remains under the 11% notional cap.",
    ],
    whenToUse:
      "Best in transitional-to-trending regimes where KAMA efficiency ratio stays above 0.39. Long-only; exits to cash in sustained bear markets via the 100-SMA filter. ETF-only universe has no earnings risk.",
    risks: [
      "7 round-trip trades over 2 years is statistically thin — Sharpe 1.68 carries wide CIs.",
      "Tuned trend_sma_period of 100 (vs textbook 200) may be regime-specific to 2023-24 AI rally; the 200-SMA default is more robust across cycles.",
      "Long-only — the strategy's framework supports shorts but the implementation doesn't; adding a mirrored short leg for sector ETFs would improve 2022-style bear behavior.",
    ],
  },

  orb: {
    thesis:
      "An intraday opening-range breakout strategy. Per Crabel (1990) and Fisher (2002), the breakout of the first-N-minutes high/low carries predictive power for the rest of the session; Zarattini & Aziz (2023) documented a Sharpe > 2 on TQQQ using a 5-minute OR with OR-low stop and EOD-flat exit. This rewrite implements the Zarattini form with tuner-selectable OR window (5 / 15 / 30 min), universe profile (SPY/QQQ vs QQQ/TQQQ vs all_leveraged), and Fibonacci extension take-profits (1.272 and 1.618 * OR width).\n\nA prior audit flagged two parallel legacy implementations that disagreed on buffer size and exit rules, shorts silently discarded, and a once-per-day snapshot wiring that only saw the breakout if it happened inside a 5-minute window at 10:05 ET. This rewrite enforces first-break-of-day, single-entry-per-day, EOD-flat at 15:55 ET, and a time-cutoff that refuses new entries after 14:00 ET.\n\nBecause the AlphaDesk backtest engine is daily-native, ORB runs as a standalone intraday simulator invoked by scripts/tune_orb.py and scripts/orb_oos_eval.py; the strategy class registers correctly but its generate_signals returns empty. 2023-2024 OOS on all_leveraged (SPY/QQQ/TQQQ/SPXL), 15-min OR, long-only: Sharpe 8.34, max DD 0.45%, CAGR 59.8%, 1337 entries (55% win rate). The headline Sharpe is a daily-returns Sharpe inflated relative to the paper's per-trade convention, and OOS on a TQQQ-heavy universe captures some of the 2023-24 NDX mega-rally. Expect regression if 2025+ presents less favorable intraday structure.",
    edge:
      "Intraday momentum from stop-loss cascades and institutional order flow that follow the first decisive directional move of the session. Fibonacci 1.272/1.618 extensions scale out in line with OR width, capturing the asymmetric payoff characteristic of breakout setups.",
    riskProfile: {
      level: "High",
      description:
        "Intraday-only, 100% flat by 15:55 ET. Position risk capped at 1.36% of equity per trade via risk = stop_distance * shares. TQQQ exposure amplifies both the win and the stop-out size 3x.",
    },
    parameters: {
      rebalanceFrequency: "Intraday (9:30-11:30 AM ET entries; EOD flat 15:55 ET)",
      universe: "SPY, QQQ, TQQQ, SPXL (all_leveraged profile selected by tuner; tuner alternates spy_qqq or qqq_tqqq)",
      positionSizing: "Turtle 1.36% risk per trade: shares = (risk * equity) / (entry - stop); max notional 20%",
      entryCriteria:
        "First close after the OR window strictly exceeds OR_high (long only per tuner) AND volume >= 0.86 * OR-window mean AND before 14:00 ET",
      exitCriteria: "OR-low stop, Fib 1.272 * OR_range scale-out, Fib 2.21 * OR_range scale-out, EOD flat at 15:55 ET",
      maxPositions: "5",
    },
    howItWorks: [
      "Fetch 1-minute bars for the active universe on the session date; filter to RTH (9:30-16:00 ET).",
      "Define OR = (max(H), min(L)) over the first 15 minutes (tuner choice from 5/15/30).",
      "Scan for the first subsequent bar whose close strictly exceeds OR_high. Enter MOO at the next bar's open if volume confirmation and time cutoff pass.",
      "Simulate in-position life: stop at OR_low (or trailed OR midpoint per stop_method), scale-out 50% at entry + 1.33 * OR_range, scale-out 50% at entry + 2.21 * OR_range.",
      "Close any residual at 15:55 ET MOC. No overnight holdings; single entry per day per symbol.",
    ],
    whenToUse:
      "Best on trending-open days with moderate overnight gaps and above-average RTH volume. Directionless chop (the intraday equivalent of a sideways tape) fails the first-break entry or immediately stops out. The strategy does not filter for macro-event days — adding a FOMC/NFP/OpEx skip is the audit's first-line intervention if OOS Sharpe regresses.",
    risks: [
      "OOS Sharpe 8.34 is on a daily-returns convention inflated relative to per-trade Sharpe — not directly comparable to paper numbers. Reporting ambiguity, not a modelling defect.",
      "Training window was 1 year (2022 only) because intraday data is ~4x slower to process than daily; the regime-dependence of OR-breakouts makes this a real uncertainty.",
      "TQQQ / SPXL tracking of daily 3x NDX / SPX returns introduces compounding drag over multi-day holds — not relevant here (EOD flat) but a risk if the strategy ever relaxes its flat-by-close invariant.",
    ],
  },

  "vwap-strategy": {
    thesis:
      "A session-anchored intraday VWAP pullback strategy on 10 deep-liquidity US names (SPY, QQQ, AAPL, MSFT, NVDA, AMZN, META, TSLA, GOOGL, AMD). The setup is: in a name whose daily close is above its long-term SMA and whose index (SPY) is above its SMA_100, enter long when intraday price has pulled back from above to within a small band around the session VWAP, 5-minute RSI is oversold, and the prior bar's price was above the prior bar's VWAP (confirming the intraday drift is still up).\n\nThis is not a Berkowitz-Logue-Noser (1988) execution-benchmark strategy — that paper measures broker execution quality against VWAP, not directional alpha. The thesis here is that intraday VWAP is a liquidity magnet because institutions execute against it (Kyle 1985 on price impact; Bouchaud et al. 2003 on square-root impact mean-reverting). The 5-minute RSI timing is Connors & Alvarez (2009) mapped to intraday bars.\n\nThe legacy AlphaDesk VWAP was a 20-day volume-weighted moving average of (H+L+C)/3 — a degenerate construct with no institutional significance, unrelated to session VWAP. This rewrite uses proper session-reset intraday VWAP via backend.indicators.volume.vwap_session. Because the engine is daily-native, the intraday signal is computed in generate_signals() from 5-min bars and executed as MOO on the engine's next daily bar — a lossy approximation documented in the spec. 2024-H1 OOS Sharpe: 0.95, max DD 5.7%, 302 trades. Tuner picked shorts-off on the 2024-H1 bull tape; a 2022-style bear test would likely enable shorts.",
    edge:
      "Trades the mean-reverting behaviour of price around session VWAP in liquid names with strong daily trend alignment. RSI oversold on 5-min bars times the entry within the VWAP band; the daily trend filter ensures we're buying pullbacks, not tops of counter-trend bounces.",
    riskProfile: {
      level: "Medium",
      description:
        "Intraday setups with daily-bar execution approximation; 5 concurrent positions at ~17% each. Stops are max(5-min ATR, 68 bps) from VWAP. EOD flat via MOC at the engine's daily close.",
    },
    parameters: {
      rebalanceFrequency: "Daily scan on 5-min intraday bars; engine executes via daily MOO/MOC",
      universe: "10 deep-liquidity US names — SPY, QQQ, AAPL, MSFT, NVDA, AMZN, META, TSLA, GOOGL, AMD",
      positionSizing: "~17% of equity per position, max 5 concurrent, one entry per name per day",
      entryCriteria:
        "Price within [VWAP, VWAP * 1.00096] AND 5-min RSI(5) < 16 AND close > prior VWAP AND SPY close > SMA_100 AND name close > SMA_100",
      exitCriteria:
        "Stop at max(68 bps below VWAP, entry - ATR), TP at entry + 0.92 * rolling-std(close - VWAP), EOD flat via MOC",
      maxPositions: "5",
    },
    howItWorks: [
      "Daily trend filter at session open: SPY close > SMA_100 AND name close > SMA_100. Skip names that fail.",
      "Compute session VWAP on 5-min bars via vwap_session (resets at session boundary). Pullback-from-above setup: last 5-min bar's close is between VWAP and VWAP * 1.00096.",
      "Confirm with 5-min RSI(5) < 16 and close > prior bar's VWAP (intraday drift still up).",
      "Emit MOO entry for the next daily bar with embedded stop = max(VWAP - 68 bps, entry - ATR_5m_14) and TP = entry + 0.92 * rolling-std-20(close - VWAP).",
      "Engine fires stop/TP when the daily high/low range envelopes the intraday-computed level. manage() always emits an MOC exit for any surviving position — no overnight holds.",
    ],
    whenToUse:
      "Works best in orderly trending sessions with well-defined VWAP support; fails on gap days when VWAP resets to a level price doesn't respect. The shorts-off tuner choice suggests the signal is currently asymmetric in 2024 bull tape; shorts may re-enable value in a sustained bear.",
    risks: [
      "Daily-bar stop/TP fills approximate intraday execution — the OOS Sharpe is ~5-10 bps per trade lossy vs a true tick-simulator.",
      "Walk-forward was 18 months (2023 train / 2024-H1 test) because 5-min intraday data is ~120x daily-bar volume; a longer OOS would tighten Sharpe CIs.",
      "No macro-day gate (unlike ORB); FOMC / NFP / OpEx days can chop the VWAP signal but weren't restrictive enough to justify the extra parameter surface in the tuner's budget.",
    ],
  },
};
