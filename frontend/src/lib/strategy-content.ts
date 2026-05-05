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
      "A long-only cross-sectional factor strategy that combines the Jegadeesh-Titman (1993) momentum family with the Piotroski (2000) F-score quality gate. The live backend default uses a classic 12-1 month momentum lookback, while the checked-in 2023-2024 OOS tune used momentum_skip_m=0, meaning it ranked 12-0 month momentum with no skipped most-recent month. On the last trading session of each month the strategy ranks a ~47-name universe of ex-Financials / ex-Utilities S&P 500 large-caps by percentile-rank of momentum and percentile-rank of F-score, requires a hard F-score floor, and holds the top 15 names equal-weighted until the next rebalance.\n\nThe quality overlay is motivated by Daniel & Moskowitz (2016) on momentum crashes: the worst left-tail momentum episodes (2009, 2022 rotation) concentrate in low-quality names, and a Piotroski gate trims them before they enter the book. Asness, Frazzini & Pedersen (2019) document that a quality-tilted composite earns materially better risk-adjusted returns than either factor alone.\n\nNo intraday logic, no stops, no take-profits. The signal is monthly; per-name stops destroy monthly-horizon signals (see Barroso & Santa-Clara 2015). The 2023-2024 walk-forward OOS Sharpe came in at 2.209 with an 8.0% max drawdown — above the 0.8 design target, but the 2023-24 regime was unusually kind to mega-cap quality momentum (NVDA / META / AAPL rally). Published long-only 12-1 momentum is a 0.6-0.9 Sharpe factor, and the checked-in 12-0 tune may be more regime-sensitive; treat the achieved OOS number as upside evidence, not a long-run expectation.",
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
        "Top composite rank of momentum + F-score percentile. Backend default is 12-1 month momentum; checked-in OOS artifact used momentum_skip_m=0 (12-0). F-score >= 7 hard gate, absolute momentum >= 5.4%, no earnings within 3 days",
      exitCriteria:
        "Falls out of top-N at the next monthly rebalance. No per-name stops, no take-profits.",
      maxPositions: "15",
    },
    howItWorks: [
      "On the last trading session of each month, compute total return for every name in the 47-ticker universe (adjusted closes): 12-1 month by backend default, 12-0 month in the checked-in OOS tune.",
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
      "The checked-in OOS tune uses momentum_skip_m=0 while the backend default remains 12-1; re-tune before treating the 2023-24 result as production-stable.",
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
      "VCP Breakout is a planned catalogue concept, not an implemented AlphaDesk backend strategy yet. No backend package detects Volatility Contraction Patterns, no intraday breakout-confirmation feed is wired into StrategyInput, and no checked-in OOS artifact validates the rules. The design goal is to systematize the breakout methodology popularized by Mark Minervini: find Stage 2 uptrend stocks forming progressively tighter bases on declining volume, then enter only after price clears the final pivot on expanding demand.\n\nThe theoretical underpinning connects to the microstructure literature on supply and demand zones and the information content of volume. Karpoff (1987) establishes the relationship between volume and price changes, while Lo & Wang (2000) supports the idea that turnover contains information about investor demand. The planned detector would need to distinguish real volatility contraction from quiet distribution, stale volume, and broad-market beta masquerading as accumulation.\n\nRisk management is only a target design today. A future implementation should define the pivot, stop distance, partial exits, slippage model, and failed-breakout handling in code before the UI offers any order button. Until that pattern detector and replay harness exist, treat this page as a product spec rather than a tradable strategy.",
    edge:
      "Future edge would come from entering growth-stock breakouts only after volatility contraction, pivot clearance, and volume confirmation align. Today the edge is unproven inside AlphaDesk because there is no backend detector or OOS replay.",
    riskProfile: {
      level: "High",
      description:
        "Planned high-risk breakout strategy. Pattern false positives, opening slippage, and regime sensitivity are unresolved because no live implementation or replayed evidence exists yet.",
    },
    parameters: {
      rebalanceFrequency:
        "Not live. Target design: daily screening with intraday breakout confirmation",
      universe:
        "Not live. Target design: US equities with market cap > $1B, price > $10, average daily volume > $2M, and EPS growth > 15% YoY",
      positionSizing:
        "Not live. Target design: risk 0.5-1% of NAV per trade based on measured pivot-to-stop distance",
      entryCriteria:
        "Not live. Target design: at least 2 successive contractions, declining volume during base, pivot breakout on volume >= 1.5x average, stock near 52-week high",
      exitCriteria:
        "Not live. Target design: hard failed-breakout stop, partial profit-taking, trailing runner, and forced close if price re-enters the base",
      maxPositions: "0 live; target 12 after implementation",
    },
    howItWorks: [
      "Do not emit live orders today; this is a planned catalogue entry with no backend implementation.",
      "Before implementation, build a deterministic VCP detector that marks contraction legs, pivot highs, volume dry-up, and Stage 2 trend context.",
      "Wire intraday bars and opening-volume confirmation into StrategyInput so breakout confirmation is not guessed from daily closes.",
      "Replay the rules with slippage above the pivot, failed-breakout stops, and partial exits before publishing any performance claim.",
      "Graduate to paper trading only after the backend package, state contract, OOS artifact, and UI order gating are checked in.",
    ],
    whenToUse:
      "Future use case: bull market conditions with clear uptrends and expanding market breadth, especially growth-led advances where leading stocks form constructive base patterns. Not active today; avoid treating catalogue candidates as orders until the detector and replay harness exist.",
    risks: [
      "No backend implementation, no OOS artifact, and no paper/live track record yet.",
      "High failure rate: approximately 40-50% of breakouts fail and are stopped out, requiring psychological discipline to accept frequent small losses.",
      "Market regime sensitivity: during bear markets or broad distribution phases, even perfect-looking VCPs fail because there is no institutional demand to absorb supply.",
      "False breakouts on low quality: volume confirmation helps but doesn't eliminate false breakouts driven by momentum ignition or algorithmic activity.",
      "Slippage risk: breakout entries require fast execution, and slippage above the pivot point reduces the risk-reward ratio of each trade.",
    ],
  },

  "pairs-trading": {
    thesis:
      "A cointegration-gated dollar-neutral statistical arbitrage strategy. Every ~42-63 trading days the strategy re-runs the Engle-Granger (1987) two-step ADF test on all within-sector pairs drawn from a 49-ticker S&P 500 mega-cap universe, keeping only pairs with ADF p < 0.05, Ornstein-Uhlenbeck half-life <= 30 days, and Hurst exponent < 0.45 (mean-reverting). Qualifying pairs are ranked by ADF p-value, and the top-N (up to 8) survivors with no ticker overlap form the active set.\n\nEntries fire on the spread's 60-day rolling z-score: at |z| >= 2.0-2.5 the strategy opens both legs simultaneously as MOO orders — one +w on the cheap leg, one -w on the rich leg, sized dollar-neutral via the OLS or Kalman hedge ratio. Exits fire at |z| < 0.5-0.7 (mean reversion), |z| > 3.5-4.7 (stop), or when a 21-day structural-break watchdog re-runs Engle-Granger on an active pair and ADF p exceeds 0.10 (force-close and retire).\n\nThe legacy AlphaDesk implementation was single-leg (shorts silently discarded, so 'market-neutral' was fiction), had no cointegration test at all, used a static hand-picked pair list with no rescreening, and held hedge ratios fixed indefinitely. This rewrite enforces a two-signal-per-pair invariant at emit time; the checked-in log-price OOS artifact verifies 52/52 entries and 44/44 exits were two-legged. Current 2023-2024 OOS Sharpe is 0.39 with max drawdown 2.5%, CAGR 1.2%, 96 trades, 59% hit rate, and 1.44 profit factor. The older 1.23 Sharpe raw-price artifact is intentionally retired.",
    edge:
      "Dollar-neutral spread convergence between cointegrated mega-cap pairs, with a quarterly Engle-Granger rescreen and a 21-day structural-break watchdog that ejects pairs whose p-value exceeds 0.10 — the mechanism the legacy code lacked that allowed T/VZ, AMZN/WMT, XOM/CVX to silently decouple.",
    riskProfile: {
      level: "Low",
      description:
        "Long/short dollar-neutral, beta near zero by construction. Primary risk is structural-break drawdowns on pairs the quarterly rescreen doesn't catch fast enough; the 21-day watchdog and z=3.5 stop bound each event.",
    },
    parameters: {
      rebalanceFrequency: "Daily z-score monitoring with MOO entries; tuned 42-day pair rescreen and 21-day watchdog",
      universe: "49 sector-grouped S&P 500 mega-caps (Tech, Financials, Energy, Health, Consumer, Industrial) — 149 within-sector candidate pairs per rescreen",
      positionSizing: "Dollar-neutral, ~6.6% NAV per pair in the checked-in tune; max 8 concurrent pairs with no ticker overlap",
      entryCriteria:
        "|z-score| >= z_entry (~2.48 tuned), spread ADF p < 0.032 tuned / 0.05 default, OU half-life <= 27-30 days, Hurst < 0.45, no active position on either leg",
      exitCriteria:
        "|z| < z_exit (~0.70 tuned) mean-revert, |z| > z_stop (~4.73 tuned) spread-break stop, or watchdog ADF p > 0.10 force-close",
      maxPositions: "8",
    },
    howItWorks: [
      "Every ~42 trading days in the checked-in tune (63 by default), run Engle-Granger ADF on all 149 within-sector pairs over a 252-day formation window. Keep survivors with ADF p < 0.05, OU half-life <= 30 days, Hurst < 0.45.",
      "Rank survivors by ADF p-value ascending; admit the top 8 with no ticker overlap to the active set. Cache hedge ratios and spread statistics.",
      "Daily: compute the spread z-score from the 60-day rolling mean/std (strict no-look-ahead). For each active pair with no open position, enter at |z| >= z_entry — two coincident MOO signals, opposite signs, sized dollar-neutral via beta_t.",
      "Exit both legs together via MOC when |z| < z_exit (convergence), |z| > z_stop (spread blow-out), or the 21-day Engle-Granger watchdog reports p > 0.10 (structural break).",
      "When hedge_method='kalman', re-estimate beta each bar via a 2-D Kalman filter (Chan 2013 eq 3.5); with 'ols' the hedge ratio is fixed from the formation fit until the next rescreen.",
    ],
    whenToUse:
      "Market-neutral by construction, so the book is uncorrelated with equity beta. Works across regimes but produces the cleanest P&L in normal-volatility environments; sector-wide news (e.g. 2022 energy rally, 2023 NVDA-led tech dispersion) can decouple multiple pairs at once.",
    risks: [
      "Cost model uses the engine default (5 bps flat spread, 1% p.a. flat borrow); real pairs traders pay 5-10 bps round-trip and 1-5% borrow on HTB names. Net Sharpe impact estimated within +/-0.10.",
      "96-trade OOS sample has a wide confidence interval; the 0.39 Sharpe point estimate is modest and still needs a log-space retune before this should be treated as a production alpha sleeve.",
      "Capacity estimate on this 49-name universe is ~$100M total AUM before edge decays (Do & Faff 2012); unsuitable for institutional scaling past ~$50M without universe expansion.",
    ],
  },

  "dividend-capture": {
    thesis:
      "Dividend Capture is a planned catalogue concept, not an implemented AlphaDesk backend strategy yet. No backend package consumes an ex-dividend calendar, models dividend-adjusted prices, applies holding-period tax rules, or emits live capture orders. The intended idea is to enter shortly before an ex-dividend date and exit after the ex-date adjustment, but that workflow needs a replayable implementation before the UI should present it as tradable.\n\nThe theoretical framework rests on the ex-dividend day pricing anomaly first documented by Elton & Gruber (1970), where stock prices often do not adjust by the full dividend amount. Later work by Frank & Jagannathan (1998) and Graham, Michaely & Roberts (2003) found that the average ex-date price drop can be less than the dividend amount, leaving a small gross opportunity before taxes, spreads, borrow/friction, and adverse selection.\n\nA production design would need to screen for sustainable dividends, sufficient liquidity, positive technical context, and point-in-time fundamental quality while explicitly modeling taxes and dividend qualification. Without those ingredients, dividend capture is especially easy to overstate because the apparent gross dividend can disappear after ex-date price adjustment, slippage, and short holding-period tax treatment.",
    edge:
      "Future edge would come from a tax-aware, liquidity-aware ex-dividend anomaly screen. Today the edge is unproven inside AlphaDesk because there is no backend implementation or OOS artifact.",
    riskProfile: {
      level: "Low",
      description:
        "Planned income strategy. The apparent low volatility can be misleading until ex-date adjustment, tax drag, adverse selection, and market selloff risk are modeled.",
    },
    parameters: {
      rebalanceFrequency: "Not live. Target design: event-driven around upcoming ex-dividend dates",
      universe: "Not live. Target design: liquid US dividend payers with sustainable yield, point-in-time quality, and clean corporate-action data",
      positionSizing: "Not live. Target design: small equal-weight captures with tax/friction-adjusted expected value",
      entryCriteria: "Not live. Target design: qualified ex-date, adequate liquidity, supportive momentum, and sustainable dividend quality",
      exitCriteria: "Not live. Target design: post-ex-date recovery exit, time stop, or risk stop after dividend-adjusted accounting",
      maxPositions: "0 live; target 5 after implementation",
    },
    howItWorks: [
      "Do not emit live orders today; this is a planned catalogue entry with no backend implementation.",
      "Before implementation, wire a corporate-actions/ex-dividend calendar and adjusted-price accounting into the strategy input contract.",
      "Build point-in-time dividend sustainability, liquidity, borrow, spread, and tax-friction filters before ranking candidates.",
      "Replay entries/exits across ex-dates using dividend-adjusted total return so the dividend itself is not double-counted as alpha.",
      "Graduate to paper trading only after the backend package, OOS artifact, state contract, and UI order gating are checked in.",
    ],
    whenToUse:
      "Future use case: stable-to-bullish, low-volatility markets where high-quality income stocks maintain their uptrends and ex-date price drops are modest. Not active today; taxes and dividend-adjusted return accounting must be proven before use.",
    risks: [
      "No backend implementation, no OOS artifact, and no paper/live track record yet.",
      "Broad market selloff during the capture window: if the market drops sharply between entry and exit, the capital loss can far exceed the dividend captured.",
      "Dividend cut risk: even with the F-Score filter, a surprise dividend cut announced near the ex-date can cause a sharp price decline.",
      "Tax inefficiency: captured dividends are taxed as ordinary income (not qualified dividends) due to the short holding period, reducing the after-tax yield.",
      "Opportunity cost: capital tied up in dividend captures cannot be deployed in higher-returning strategies during the 5-7 day holding period.",
    ],
  },

  "sector-rotation": {
    thesis:
      "A long-only macro / tactical-asset-allocation strategy that rotates monthly across the 11 GICS sector SPDR ETFs (XLK, XLV, XLF, XLY, XLP, XLE, XLI, XLB, XLRE, XLU, XLC), ranking each sector by an equal-weighted composite of 6-month + 12-month total return and holding the top 3 at equal weight. On the last NYSE trading session of each calendar month the backend package (`backend/strategies/sector_rotation/`) probes SPY's trailing 6-month return: if it is negative, the entire book flips to the bond fallback (AGG by default); otherwise the top-3 sector basket is rebuilt at MOO on the next open.\n\nThe two ideas the strategy stacks are well-documented. Stangl, Jacobsen & Visaltanachoti (2009) and Moskowitz & Grinblatt (1999) show that sector- and industry-level momentum is a robust signal beyond stock-level momentum, with sector relative-strength persisting over 3-12 month horizons. Faber (2013) shows that a simple bond-fallback rule (when broad-market trailing return < 0, hold bonds) materially compresses drawdowns in 1973-74, 2000-02, 2008, and 2020-Q1 without sacrificing long-run CAGR. Combining the two on the SPDR sector universe gives the cleanest expression — membership is fixed, liquidity is deep, and monthly rebalance turnover is structurally cheap.\n\nNo intraday logic, no per-name stops, no take-profits. The signal is monthly; per-trade stops destroy monthly-horizon momentum signals. Entries and exits use OrderType.MOO with DAY time-in-force at the next session's open. The published Stangl-Jacobsen-Visaltanachoti band is 1.5-3% annualized excess return for 6m+12m sector momentum after costs; the Faber bond-fallback rule cuts max drawdown by ~30-50% in equity-bear regimes. A plausible forward Sharpe band on the 2019-2024 OOS window is 0.4-0.8 — the 2023-24 sub-window favoured XLK heavily, so any backtest restricted to those 2 years will look inflated.",
    edge:
      "Stacks two independent, well-documented signals: sector-level cross-sectional momentum (Stangl-Jacobsen-Visaltanachoti, Moskowitz-Grinblatt) and a Faber-style time-series-momentum risk-off rule that flips the book to bonds when SPY's 6-month return is negative. Sector ETFs deliver the cleanest expression — fixed membership, deep liquidity, structurally cheap monthly turnover.",
    riskProfile: {
      level: "Medium",
      description:
        "Long-only ETF rotation, top-3 sectors held equal-weight (33% each). Concentration risk is real — a sharp single-sector reversal moves the book materially. The bond-fallback overlay caps equity-bear drawdowns but can underperform in V-shaped recoveries when defensives lag the bounce.",
    },
    parameters: {
      rebalanceFrequency:
        "Monthly (last NYSE trading session; MOO fill next open). `rebalance_freq=\"bimonthly\"` halves the cadence to alternate months only.",
      universe:
        "11 GICS sector SPDR ETFs (XLK, XLV, XLF, XLY, XLP, XLE, XLI, XLB, XLRE, XLU, XLC) plus AGG/IEF/TLT/BIL bond-fallback choices and SPY (risk-off probe). XLRE pre-Oct-2015 and XLC pre-Jun-2018 are absent; the strategy ranks whatever's available and falls back to bonds if top_n can't be filled.",
      positionSizing:
        "Equal-weight 1/top_n across the selected sectors (default 33% each). 100% bond fallback when risk-off triggers.",
      entryCriteria:
        "Top-N sectors by composite_score = 0.5 × R_6m + 0.5 × R_12m (total return; tunable via `short_weight`). Risk-off gate: SPY trailing 6m return must be ≥ 0; below that, hold 100% AGG.",
      exitCriteria:
        "Replaced at next monthly rebalance — anything not in the new top-N is closed MOO, new entrants are sized to 1/top_n. No per-name stops, no take-profits.",
      maxPositions: "3 (configurable via `top_n`, range 1-11)",
    },
    howItWorks: [
      "On the last NYSE trading session of each calendar month, build a wide close panel for the 11 sector ETFs + SPY + bond-fallback choices, truncated to asof to prevent right-edge look-ahead leakage.",
      "Risk-off probe first: compute SPY's trailing 6-month total return. If negative, flip the entire book to AGG (the bond fallback) at MOO and skip the sector ranking.",
      "Otherwise, compute composite_score = short_weight × R_6m + (1 − short_weight) × R_12m for every sector ETF with sufficient history; sectors missing data (XLRE pre-2015, XLC pre-2018) are skipped, not zero-filled.",
      "Rank the scored sectors descending; pick the top 3 (or top_n). If fewer than top_n sectors clear the data check, fall back to bonds rather than overweight a thin basket.",
      "Emit MOO entries at 1/top_n equal-weight for every target; close any existing position not in the new target set at MOO. DAY-TIF orders that don't print expire and re-emerge on the next monthly rebalance.",
    ],
    whenToUse:
      "Designed as a tactical macro sleeve that participates in trending bull regimes through whichever sectors are leading, then steps out of equities entirely when SPY's intermediate-term return turns negative. Strongest when sector leadership persists for multiple months (clear macro themes); weakest in choppy, leadership-rotating regimes where the monthly composite ranking lags the rotation.",
    risks: [
      "Concentration risk — top-3 at equal weight means 33% per sector; a sharp single-sector reversal (Technology Q4 2018, Energy 2014-15) drives outsized portfolio-level drawdowns.",
      "Whipsaw — monthly cadence is structurally cheap but lags fast macro pivots; the strategy can overweight lagging sectors for one full month after a regime change.",
      "Momentum crash — during market stress, the highest-momentum sectors can reverse violently; the bond-fallback gate softens but does not eliminate the left tail because SPY's 6m return takes time to flip negative.",
      "Recovery lag — at bear-market bottoms the strategy may still be in AGG (or in defensive sectors that led the down-leg) while leading recovery sectors rally, missing the initial bounce.",
      "Sector-ETF availability — pre-Oct-2015 backtests only see 9 sectors (no XLRE) and pre-Jun-2018 only 10 (no XLC); historical OOS comparisons must caveat this.",
    ],
  },

  "gap-fill": {
    thesis:
      "Gap Fill is a planned intraday concept, not an implemented AlphaDesk backend strategy yet. No backend package consumes premarket quotes or 1-minute bars, no catalyst-screening layer exists, and no live order path fades opening gaps. The design idea is to trade liquid large-cap gaps that are likely to mean-revert during the first 30-90 minutes of regular trading, but that edge cannot be trusted without intraday data and a replayed slippage model.\n\nResearch by Branch & Ma (2012) documented that some overnight gaps partially or fully revert, especially when the gap is not tied to a material catalyst. The hard part is classification: earnings, M&A, FDA decisions, index rebalances, and macro shocks can create gaps that should not be faded. A production implementation must separate noise gaps from information gaps before any order button appears.\n\nThe future design would likely close all positions by 11:00 AM ET, use gap-size-scaled sizing, and refuse high-volatility regimes, but those are only target rules today. Until the app has premarket/intraday bars, catalyst flags, and open-auction slippage modeling, this strategy should remain a planned research spec.",
    edge:
      "Future edge would come from filtering for non-catalyst overnight gaps that mean-revert after the opening auction. Today the edge is unproven inside AlphaDesk because there is no intraday backend or OOS artifact.",
    riskProfile: {
      level: "High",
      description:
        "Planned high-risk intraday strategy. Catalyst misclassification, opening slippage, and data latency are unresolved until a replayable intraday implementation exists.",
    },
    parameters: {
      rebalanceFrequency: "Not live. Target design: intraday 9:30-11:00 AM ET window",
      universe: "Not live. Target design: liquid large-caps with reliable premarket indications and intraday bars",
      positionSizing: "Not live. Target design: 1-2% NAV per trade, scaled down as gap size and catalyst risk rise",
      entryCriteria: "Not live. Target design: gap > 1%, normal VIX regime, no earnings/M&A/material catalyst, confirmed open liquidity",
      exitCriteria: "Not live. Target design: partial gap-fill target, stop at gap extreme, or 11:00 AM ET time stop",
      maxPositions: "0 live; target 3 after implementation",
    },
    howItWorks: [
      "Do not emit live orders today; this is a planned catalogue entry with no backend implementation.",
      "Before implementation, wire premarket indications, 1-minute bars, opening-auction fills, and intraday exits into StrategyInput.",
      "Build a catalyst classifier for earnings, M&A, FDA, macro, analyst, and index-event gaps so genuine information gaps are not faded.",
      "Replay the strategy with realistic opening slippage and latency before publishing any performance claim.",
      "Graduate to paper trading only after the backend package, OOS artifact, state contract, and UI order gating are checked in.",
    ],
    whenToUse:
      "Future use case: normal-volatility sessions where overnight gaps are likely noise rather than genuine catalysts. Not active today; premarket data, catalyst screening, and open-auction slippage modeling are prerequisites.",
    risks: [
      "No backend implementation, no OOS artifact, and no paper/live track record yet.",
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
      "Sign-of-12-month-return momentum earns the trend risk premium across loosely-correlated asset classes, and per-asset inverse-vol weighting ensures no single leg dominates. Crisis-alpha behavior requires short legs to be enabled; the checked-in OOS tuner selected shorts off for the 2023-2024 bull window, so treat that sample as long-only trend diversification rather than proof of crash convexity.",
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
      "Antonacci's (2014) Global Equities Momentum (GEM): a single-asset monthly rotation across US equity, ex-US equity, and aggregate bonds, driven jointly by absolute momentum (12-month equity return > T-bill return) and relative momentum (US-equity 12m vs ex-US 12m). The portfolio holds 100% of one sleeve at a time — the winning equity index if absolute momentum is positive, aggregate bonds if not.\n\nA prior audit found the legacy AlphaDesk 'dual_momentum' was actually a 30-name cross-sectional Jegadeesh-Titman screener with a SPY on/off gate — not GEM at all. It omitted the bond fallback (the defining feature), the T-bill excess-return comparator (used nominal > 0), the ex-US equity sleeve, and layered 8% stops + 20% take-profits that destroy a 12-month signal (flagged in prior audit). This rewrite restores the textbook rules: monthly rebalance on the last trading day, 100% notional in one sleeve, no stops, no take-profits, no sizing games.\n\nAntonacci's 1974-2013 backtest reports CAGR ~15.7%, Sharpe ~0.87, max-DD ~17.8% vs SPY ~51%. The 2022 dual-bear (AGG -13%, SPY -18%) is a documented failure mode — the bond fallback offers no hiding place when both legs fall together. The checked-in 2023-2024 OOS artifact uses textbook defaults (VOO/VEU/AGG/BIL, 252-day lookback): Sharpe 1.26, max DD 10.3%, CAGR 14.1%, and only 3 round trips. A prior diagnostic tune found a non-GEM SPY/EFA/EEM + blended-lookback variant near Sharpe 1.34, but that variant is intentionally excluded from the production search space. SPY buy-and-hold over the same window scored Sharpe 1.82 — DM's structural edge is drawdown control across full cycles, not upside capture in a strong narrow bull.",
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
      "A cointegration-gated dollar-neutral statistical arbitrage strategy. This catalogue entry is retained as an alias concept for the implemented pairs-trading backend; the frontend strategy list no longer shows it as a separate live system. Every ~42-63 trading days the backend re-runs the Engle-Granger (1987) two-step ADF test on within-sector pairs drawn from a 49-ticker S&P 500 mega-cap universe, keeping only pairs with ADF p < 0.05, Ornstein-Uhlenbeck half-life <= 30 days, and Hurst exponent < 0.45.\n\nEntries fire at |z-score| >= 2.0-2.5 on the 60-day rolling spread, with both legs emitted as coincident MOO orders sized dollar-neutral via the OLS or Kalman hedge ratio. Exits fire at |z| < 0.5-0.7, |z| > 3.5-4.7 stop, or a 21-day Engle-Granger watchdog that retires pairs whose cointegration p-value decays past 0.10. Current log-price OOS Sharpe is 0.39 across 96 trades; the older 1.23 Sharpe raw-price artifact is retired.",
    edge:
      "Dollar-neutral spread convergence between cointegrated pairs with a quarterly rescreen and a 21-day structural-break watchdog — the mechanism the legacy code lacked that allowed decoupled mega-cap pairs to accumulate silent losses.",
    riskProfile: {
      level: "Low",
      description:
        "Long/short dollar-neutral, beta near zero. Primary risk is structural-break drawdowns on pairs the watchdog doesn't catch fast enough.",
    },
    parameters: {
      rebalanceFrequency: "Daily z-score monitoring; tuned 42-day rescreen; 21-day watchdog",
      universe: "49 sector-grouped S&P 500 mega-caps across Tech, Financials, Energy, Health, Consumer, Industrial",
      positionSizing: "Dollar-neutral, ~6.6% NAV per pair in the checked-in tune; up to 8 concurrent pairs with distinct tickers",
      entryCriteria: "Engle-Granger ADF p < 0.032 tuned / 0.05 default, OU half-life <= 27-30d, Hurst < 0.45, |z-score| >= 2.48 tuned",
      exitCriteria: "|z| < 0.70 tuned (mean revert), |z| > 4.73 tuned (stop), or watchdog ADF p > 0.10 (break)",
      maxPositions: "8",
    },
    howItWorks: [
      "Every ~42 trading days in the checked-in tune (63 by default), Engle-Granger ADF test on all within-sector pairs over 252-day formation. Admit survivors with p < 0.05, OU half-life <= 30d, Hurst < 0.45.",
      "Daily: compute 60-day rolling z-score on each active pair. Enter both legs at |z| >= 2.0 — two coincident MOO signals, opposite signs, sized dollar-neutral via hedge ratio.",
      "Exit both legs together via MOC when |z| < 0.5 (convergence), |z| > 3.5 (spread blow-out), or the 21-day watchdog reports ADF p > 0.10.",
      "OLS hedge ratio is fixed between rescreens; Kalman hedge ratio updates each bar via Chan 2013 eq 3.5.",
      "Enforce two-leg invariant at emit time — every entry/exit adds/removes exactly two coincident signals.",
    ],
    whenToUse:
      "Market-neutral so uncorrelated with equity beta. Cleanest P&L in normal-volatility environments; sector-wide news (2022 energy rally, 2023 NVDA-led tech dispersion) can decouple multiple pairs at once.",
    risks: [
      "Cost model is the engine default (5 bps flat spread, 1% flat borrow); real costs are 5-10 bps round-trip and 1-5% borrow on HTB names — net Sharpe impact estimated within +/-0.10.",
      "96-trade OOS sample has a wide confidence interval; the 0.39 Sharpe point estimate is modest and needs a log-space retune before production allocation.",
      "Capacity on this 49-name universe estimated at ~$100M total AUM before edge decays (Do & Faff 2012).",
    ],
  },

  "kama-breakout": {
    thesis:
      "A long-only adaptive trend-breakout strategy combining Kaufman's (1995) KAMA with a Donchian N-day high breakout, a Kaufman Efficiency Ratio gate, and a long-term SMA trend filter. The ER gate (default 0.30, tuned audit value 0.39) is the specific fix the audit flagged: the legacy code computed ER and logged it but never gated on it, so every micro-rally past the Donchian high fired a signal. With the gate, only moves where a sufficient fraction of the net period return is coming from the direction of travel fire.\n\nSizing follows the Turtle convention (Faith 2007) — roughly 1% of equity risked per trade, with shares = (risk * equity) / stop_distance. The tuned audit run used a 3.63 * ATR stop distance; backend defaults remain 3.0 * ATR, 200-SMA, max 8 positions, and no pyramiding. The legacy code wrote shares = 0.01 * equity / ATR and placed a 3-ATR stop, so realized risk per trade was 3%. This rewrite uses the stop distance explicitly. Exits are chandelier trailing stop OR KAMA crossunder; no hard take-profit.\n\nA structured OOS artifact is now checked in from the existing audit tune: 2023-2024 on a 14-ETF universe reports Sharpe 1.685, max DD 3.43%, CAGR 9.38%, and 85.7% hit rate across 7 round-trip trades. The strategy is still paper-only because 7 trades over 2 years is statistically thin; treat the result as not falsified, not production-validated.",
    edge:
      "KAMA's efficiency ratio gates entries to genuinely trending regimes, cutting whipsaw trade count versus a pure Donchian breakout. The long-term SMA trend filter is the biggest risk-control contributor; backend defaults keep the more conservative 200-SMA while the audit tune used 100-SMA.",
    riskProfile: {
      level: "Medium",
      description:
        "Long-only, paper-only trend-following; backend defaults allow up to 8 concurrent positions capped at 15% notional each, while the audit tune used 5 at ~11% each. Trend filter keeps the book in cash during sustained bear markets.",
    },
    parameters: {
      rebalanceFrequency: "Daily scan; MOO entries on breakout confirmation",
      universe: "14 ETFs — SPY, QQQ, IWM + 11 GICS sector ETFs (XLE, XLF, XLK, XLV, XLI, XLP, XLU, XLY, XLB, XLRE, XLC)",
      positionSizing: "Backend default: Turtle 1% risk per trade, shares = (0.01 * equity) / (3.0 * ATR), max 15% notional. Audit tune: 0.0102 risk / 3.63 ATR / ~11% cap",
      entryCriteria:
        "Close > KAMA AND close > Donchian_upper(30) AND ER >= 0.39 AND close > SMA_100 (rising) AND no earnings +/-2 days",
      exitCriteria: "Chandelier stop (highest high - 3.63 * ATR, ratcheting) OR close < KAMA",
      maxPositions: "8 default; 5 in the audit tune",
    },
    howItWorks: [
      "Compute KAMA with ER period 10, fast 3, slow 20 (tuner-selected; textbook Kaufman fast=2, slow=30).",
      "At each bar, gate on: close > KAMA AND close > Donchian upper(30) excluding today AND ER >= 0.39 AND close > rising SMA_100 AND no scheduled earnings within 2 days.",
      "Compute ATR(22) and size shares = (0.0102 * equity) / (3.63 * ATR). Cap position notional at ~11% of equity.",
      "Manage each bar: ratchet the chandelier stop up to highest_high - ATR_multiple * ATR. Exit on stop hit or KAMA crossunder. No hard take-profit.",
      "No pyramiding in the current backend; the old pyramid state was removed until a fresh OOS pass validates add-on units.",
    ],
    whenToUse:
      "Best in transitional-to-trending regimes where KAMA efficiency ratio stays above 0.39. Long-only; exits to cash in sustained bear markets via the 100-SMA filter. ETF-only universe has no earnings risk.",
    risks: [
      "7 round-trip trades over 2 years is statistically thin — Sharpe 1.68 carries wide CIs, so the strategy stays paper-only.",
      "Tuned trend_sma_period of 100 (vs textbook 200) may be regime-specific to 2023-24 AI rally; the 200-SMA default is more robust across cycles.",
      "Long-only — the strategy's framework supports shorts but the implementation doesn't; adding a mirrored short leg for sector ETFs would improve 2022-style bear behavior.",
    ],
  },

  orb: {
    thesis:
      "ORB is currently a research-only registered strategy. Per Crabel (1990) and Fisher (2002), the breakout of the first-N-minutes high/low can carry predictive power for the rest of the session, and Zarattini & Aziz (2023) documented a strong TQQQ opening-range variant. AlphaDesk has a standalone intraday simulator for this idea, but the registered backend strategy returns no live signals until 1-minute intraday bars are wired into StrategyInput.\n\nA prior audit flagged two parallel legacy implementations that disagreed on buffer size and exit rules, shorts silently discarded, and a once-per-day snapshot wiring that only saw the breakout if it happened inside a 5-minute window at 10:05 ET. The research shell is safer: it exposes parameters and metadata, but refuses live signal emission while the execution path is daily-native.\n\nThe canonical checked-in artifact is the Wave-2 defaults run, not the retired leveraged/tuned headline. Defaults on SPY/QQQ-style profiles report Sharpe 4.78, max DD 1.22%, CAGR 12.6%, 258 entries, and a 95% Sharpe interval that includes zero (-0.02 to 9.57). A separate retuned artifact reaches Sharpe 9.96, but the tuner optimized directly on the 2023-2024 OOS window, so that number is preserved only as an OOS-peeking warning.",
    edge:
      "Research-stage intraday momentum from stop-loss cascades and institutional order flow that follow the first decisive directional move of the session. The edge is not live in the registered backend until true 1-minute execution is integrated.",
    riskProfile: {
      level: "High",
      description:
        "Research-only backend today. The standalone simulator is intraday-only and flat by 15:55 ET, but no registered strategy orders should be emitted until 1-minute execution is wired and the tuner no longer peeks at OOS.",
    },
    parameters: {
      rebalanceFrequency: "Research shell; standalone simulator is intraday and EOD-flat at 15:55 ET",
      universe: "Registered profiles: spy_qqq (SPY, QQQ) or qqq_tqqq (QQQ only in current config); no all_leveraged profile in the backend config",
      positionSizing: "No live sizing in registered backend. Simulator default: 1% risk per trade with max_notional_pct 100%",
      entryCriteria:
        "No live entries. Simulator default: first close after 5-min OR exceeds OR_high, volume >= 1.2 * OR-window mean, before 14:00 ET",
      exitCriteria: "No live exits. Simulator default: OR-bound stop, Fib 1.272/1.618 scale-outs, EOD flat at 15:55 ET",
      maxPositions: "0 live",
    },
    howItWorks: [
      "Registered strategy returns diagnostics {research_shell: true} and emits no signals.",
      "Standalone simulator fetches 1-minute bars for the active universe on the session date and filters to RTH (9:30-16:00 ET).",
      "Define OR = (max(H), min(L)) over the configured 5/15/30-minute window.",
      "Scan for the first subsequent bar whose close strictly exceeds OR_high, subject to volume confirmation and time cutoff.",
      "Simulate stop/scale-out/EOD-flat behavior, then keep the result out of live routing until StrategyInput carries intraday bars.",
    ],
    whenToUse:
      "Research-only until intraday execution lands. If enabled later, best on trending-open days with moderate overnight gaps and above-average RTH volume.",
    risks: [
      "Registered backend emits no signals today; presenting simulator metrics as live strategy performance would be misleading.",
      "Canonical Wave-2 defaults Sharpe 4.78 has a 95% interval that includes zero; evidence is promising but not production-grade.",
      "Retuned Sharpe 9.96 is OOS-peeking because the tuner optimized directly on the 2023-2024 OOS window.",
    ],
  },

  "vwap-strategy": {
    thesis:
      "VWAP is currently a research-only registered strategy. The intended session-anchored intraday pullback system trades 10 deep-liquidity US names (SPY, QQQ, AAPL, MSFT, NVDA, AMZN, META, TSLA, GOOGL, AMD): in a name whose daily close is above its long-term SMA and whose index (SPY) is above its SMA_100, enter long when intraday price has pulled back from above to near session VWAP, 5-minute RSI is oversold, and the prior bar's price was above the prior bar's VWAP.\n\nThis is not a Berkowitz-Logue-Noser (1988) execution-benchmark strategy — that paper measures broker execution quality against VWAP, not directional alpha. The thesis here is that intraday VWAP is a liquidity magnet because institutions execute against it (Kyle 1985 on price impact; Bouchaud et al. 2003 on square-root impact mean-reverting). The 5-minute RSI timing is Connors & Alvarez (2009) mapped to intraday bars.\n\nThe registered backend emits no signals until 5-minute intraday bars are available in StrategyInput. A standalone research artifact reports 2024-H1 Sharpe 0.95, max DD 5.7%, 302 trades, 56.3% hit rate, and 1.31 profit factor with shorts off. Treat that as research evidence only, because the live strategy class is still a no-order shell.",
    edge:
      "Research-stage mean reversion around session VWAP in liquid names with strong daily trend alignment. The edge is not live in the registered backend until 5-minute execution is integrated.",
    riskProfile: {
      level: "Medium",
      description:
        "Research-only backend today. The standalone artifact used intraday setups with daily-bar execution approximation, 5 concurrent positions at ~17% each, and EOD-flat behavior.",
    },
    parameters: {
      rebalanceFrequency: "Research shell; standalone artifact scans 5-minute intraday bars and approximates daily MOO/MOC execution",
      universe: "10 deep-liquidity US names — SPY, QQQ, AAPL, MSFT, NVDA, AMZN, META, TSLA, GOOGL, AMD",
      positionSizing: "No live sizing in registered backend. Research artifact: ~17% of equity per position, max 5 concurrent, one entry per name per day",
      entryCriteria:
        "No live entries. Research artifact: price within [VWAP, VWAP * 1.00096] AND 5-min RSI(5) < 16 AND close > prior VWAP AND SPY/name close > SMA_100",
      exitCriteria:
        "No live exits. Research artifact: stop at max(68 bps below VWAP, entry - ATR), TP at entry + 0.92 * rolling-std(close - VWAP), EOD flat",
      maxPositions: "0 live; 5 in research artifact",
    },
    howItWorks: [
      "Registered strategy returns diagnostics {research_shell: true} and emits no signals.",
      "Research artifact daily trend filter: SPY close > SMA_100 AND name close > SMA_100. Skip names that fail.",
      "Compute session VWAP on 5-min bars via vwap_session (resets at session boundary). Pullback-from-above setup: last 5-min bar's close is between VWAP and VWAP * 1.00096.",
      "Confirm with 5-min RSI(5) < 16 and close > prior bar's VWAP (intraday drift still up).",
      "Research artifact emits a next-bar entry with embedded stop = max(VWAP - 68 bps, entry - ATR_5m_14) and TP = entry + 0.92 * rolling-std-20(close - VWAP).",
      "Keep the result out of live routing until StrategyInput carries 5-minute bars and fills are simulated/executed intraday.",
    ],
    whenToUse:
      "Research-only until 5-minute execution lands. If enabled later, best in orderly trending sessions with well-defined VWAP support.",
    risks: [
      "Registered backend emits no signals today; presenting research artifact metrics as live strategy performance would be misleading.",
      "Daily-bar stop/TP fills approximate intraday execution — the research Sharpe is estimated to be ~5-10 bps per trade lossy vs a true tick-simulator.",
      "Walk-forward was 18 months (2023 train / 2024-H1 test) because 5-min intraday data is ~120x daily-bar volume; a longer OOS would tighten Sharpe CIs.",
      "No macro-day gate; FOMC / NFP / OpEx days can chop the VWAP signal but were not restrictive enough to justify the extra parameter surface in the research tuner's budget.",
    ],
  },
};
