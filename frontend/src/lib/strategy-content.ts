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
      "This strategy combines the well-documented cross-sectional momentum anomaly with fundamental quality screening to construct a portfolio of stocks exhibiting both strong price trends and robust financial health. The momentum component follows the canonical 12-minus-1 month formation period established by Jegadeesh & Titman (1993), skipping the most recent month to avoid the short-term reversal effect documented by Lehmann (1990). By ranking the investable universe on prior returns and selecting from the top decile, the strategy captures the tendency of past winners to continue outperforming over intermediate horizons — an effect that has persisted across geographies and decades, as confirmed by Asness, Moskowitz & Pedersen (2013) in their seminal study of value and momentum everywhere.\n\nThe quality overlay uses the Piotroski F-Score (Piotroski, 2000), a composite measure of profitability, leverage, and operating efficiency, requiring a score of 6 or higher for portfolio inclusion. This filter serves a dual purpose: it eliminates financially distressed firms that may exhibit high momentum due to speculative activity or short squeezes, and it selects for companies whose price appreciation is grounded in genuine fundamental improvement. Research by Asness, Frazzini & Pedersen (2019) demonstrates that quality factors earn a significant premium and, critically, exhibit negative correlation with momentum drawdowns.\n\nThe intersection of momentum and quality directly addresses the primary risk of pure momentum strategies — catastrophic crash risk during market reversals. Momentum crashes, as analyzed by Daniel & Moskowitz (2016), tend to concentrate in low-quality, high-beta names. By excluding these through the F-Score screen, the strategy preserves the core momentum premium while substantially reducing tail risk, resulting in a more favorable Sharpe ratio and maximum drawdown profile than either factor in isolation.",
    edge: "Exploits the behavioral underreaction to gradual information flow in fundamentally sound companies, where institutional herding amplifies trends that quality screening ensures are grounded in real earnings improvement rather than speculative excess.",
    riskProfile: {
      level: "Medium",
      description:
        "Quality screening materially reduces momentum crash risk, but the strategy remains exposed to broad factor rotations and can underperform during sharp reversals from growth to value.",
    },
    parameters: {
      rebalanceFrequency: "Monthly (first trading day)",
      universe: "S&P 500 constituents, excluding financials and REITs",
      positionSizing: "Equal-weight across selected positions",
      entryCriteria:
        "Top-decile 12-minus-1 month momentum AND Piotroski F-Score >= 6",
      exitCriteria:
        "Falls below top-quartile momentum OR F-Score drops below 5",
      maxPositions: "20",
    },
    howItWorks: [
      "Screen the S&P 500 universe monthly, ranking all stocks by 12-minus-1 month total return (skipping the most recent month to avoid reversal effects).",
      "Filter the top-decile momentum stocks through a Piotroski F-Score quality screen, requiring a score of 6 or higher to confirm fundamental health.",
      "Construct an equal-weight portfolio of qualifying stocks (up to 20 positions) on the first trading day of each month.",
      "Monitor positions daily for F-Score deterioration or momentum rank collapse; exit individual names that fall below the top-quartile momentum threshold or whose F-Score drops below 5.",
      "Full portfolio rebalance occurs monthly, replacing exited positions with the next-qualifying candidates from the ranked universe.",
    ],
    whenToUse: "This strategy excels during sustained bull markets with clear sector leadership and trending conditions. It performs best when market breadth is expanding and institutional capital is flowing into quality growth names. Avoid deploying during sharp factor rotation episodes (e.g., sudden growth-to-value pivots) or during periods of extreme market stress where momentum crashes are historically concentrated.",
    risks: [
      "Momentum crash risk during sharp market reversals, though quality screening reduces this significantly compared to pure momentum strategies.",
      "Factor crowding: when too many systematic strategies chase the same momentum+quality names, exit liquidity can evaporate during drawdowns.",
      "Underperformance during value-led rallies where low-quality, beaten-down names lead the recovery.",
      "Monthly rebalancing frequency may lag rapid regime changes, resulting in holding stale winners.",
    ],
  },

  pead: {
    thesis:
      "Post-Earnings Announcement Drift is one of the most robust and persistent anomalies in empirical finance, first rigorously documented by Bernard & Thomas (1989, 1990). The phenomenon describes the tendency of stock prices to continue drifting in the direction of an earnings surprise for 60 to 90 days following the announcement, contradicting the semi-strong form of the Efficient Market Hypothesis. This strategy monetizes PEAD through defined-risk bull call spreads on companies that report earnings above consensus estimates, capturing the directional drift while capping downside exposure through the spread structure.\n\nThe persistence of PEAD is attributed to a combination of investor underreaction to earnings news — rooted in anchoring bias and the slow diffusion of information through analyst revisions — and institutional constraints that prevent rapid price adjustment. Livnat & Mendenhall (2006) show that the drift is strongest for firms with lower analyst coverage, higher earnings surprise magnitude, and more persistent earnings processes. The strategy exploits this by filtering for surprise magnitude relative to historical standard deviation (SUE score) and targeting names where the informational gap between the earnings signal and full price incorporation is widest.\n\nThe use of bull call spreads rather than outright equity positions reflects a deliberate risk management choice. Options allow the strategy to express a directional view with defined maximum loss, while benefiting from the favorable gamma profile in the days immediately following earnings when post-announcement volatility is often underpriced relative to realized moves. The 30-to-60-day holding period aligns with the empirically observed drift window while avoiding the decay of the signal documented by Ke & Ramalingegowda (2005) beyond the quarterly horizon.",
    edge: "Captures systematic investor underreaction to earnings surprises — a well-documented behavioral anomaly where prices take 60-90 days to fully incorporate the information content of earnings beats, amplified by anchoring bias in analyst estimate revisions.",
    riskProfile: {
      level: "Medium",
      description:
        "Risk is defined per trade by the spread width, but the strategy is exposed to broad market drawdowns that can overwhelm stock-specific earnings drift during periods of elevated systematic risk.",
    },
    parameters: {
      rebalanceFrequency: "Event-driven (triggered by earnings releases)",
      universe:
        "S&P 500 and Russell 1000 stocks reporting quarterly earnings with liquid options markets",
      positionSizing:
        "1-2% of portfolio NAV per spread, scaled by SUE score magnitude",
      entryCriteria:
        "EPS beat >= 1 standard deviation above consensus (SUE > 1.0), confirmed by revenue beat, with options IV percentile below 70",
      exitCriteria:
        "Spread expiration at 30-60 DTE, or early close at 80% of max profit",
      maxPositions: "15",
    },
    howItWorks: [
      "Monitor the earnings calendar daily for upcoming quarterly earnings announcements across the S&P 500 and Russell 1000.",
      "After each earnings release, compute the Standardized Unexpected Earnings (SUE) score by comparing actual EPS to consensus estimates relative to historical surprise variability.",
      "Filter for stocks with SUE > 1.0 (strong beats) that also beat on revenue, with options IV percentile below 70 (avoiding overpaying for already-priced drift).",
      "Enter bull call spreads with 30-60 DTE on qualifying names, sizing at 1-2% of NAV per spread, scaled by SUE magnitude.",
      "Hold through the drift window; close at 80% of max profit or at spread expiration. The defined-risk spread structure caps maximum loss per trade.",
    ],
    whenToUse: "PEAD works across market regimes because it is event-driven rather than directionally dependent. It is most effective during normal earnings seasons with typical dispersion. Performance improves when analyst coverage is thin and earnings surprises are large relative to historical variability. Avoid heavy deployment during periods of extreme macro uncertainty where stock-specific signals are overwhelmed by systematic risk (e.g., sudden tariff announcements, rate shock events).",
    risks: [
      "Broad market drawdowns can overwhelm stock-specific drift, causing all spreads to lose value simultaneously regardless of earnings quality.",
      "Earnings surprise quality degradation: if consensus estimates become more accurate over time, SUE scores compress and drift magnitude shrinks.",
      "Options liquidity risk: illiquid spread markets can result in poor fill prices that erode the edge.",
      "Crowding from other PEAD-focused systematic strategies can front-run the drift, reducing available alpha.",
    ],
  },

  "vrp-harvesting": {
    thesis:
      "The Volatility Risk Premium — the persistent spread between implied and realized volatility — represents one of the most well-documented and economically intuitive risk premia in financial markets. Ilmanen (2011) provides extensive evidence across asset classes showing that implied volatility systematically exceeds subsequent realized volatility approximately 85% of the time, reflecting the insurance premium that hedgers pay to option sellers. This strategy systematically harvests this premium by selling delta-neutral strangles on underlyings exhibiting elevated implied volatility rank, effectively acting as the insurance provider in the options market.\n\nThe economic rationale for the VRP is grounded in the asymmetric utility functions of market participants. Institutional investors, constrained by mandates, regulatory requirements, and career risk, demonstrate persistent demand for downside protection that exceeds actuarially fair pricing. Bollen & Whaley (2004) show this demand pressure creates a structural supply-demand imbalance, particularly in index options, that results in chronically overpriced implied volatility. The strategy targets underlyings with IV Rank above 50, ensuring entry only when implied volatility is elevated relative to its own history — a condition that maximizes the expected premium capture while providing a margin of safety against realized volatility spikes.\n\nPosition construction employs delta-neutral strangles with strikes selected at approximately 16-delta on each side (roughly one standard deviation), creating a wide profit zone consistent with the empirical distribution of returns. Portfolio-level Greeks are actively managed: delta is hedged within defined bands, and aggregate vega exposure is capped to prevent concentration risk. The strategy incorporates regime-awareness by reducing notional exposure during periods of elevated VIX term structure inversion, which signals that market participants are pricing near-term risk above forward expectations — a condition historically associated with VRP compression or inversion.",
    edge: "Harvests the structural supply-demand imbalance in options markets where institutional hedging demand for tail protection chronically overprices implied volatility relative to subsequent realized moves, particularly during periods of elevated but mean-reverting IV.",
    riskProfile: {
      level: "High",
      description:
        "Short volatility strategies carry convex downside risk — losses can be multiples of premiums collected during volatility spikes or gap moves, requiring rigorous position sizing and portfolio-level risk controls.",
    },
    parameters: {
      rebalanceFrequency:
        "Weekly rolling with daily delta adjustments",
      universe:
        "High-liquidity ETFs and large-cap equities with tight bid-ask spreads in options (SPY, QQQ, IWM, individual names with average options volume > 5,000 contracts/day)",
      positionSizing:
        "Notional exposure capped at 2x portfolio NAV; individual position max 5% of NAV based on buying-power reduction",
      entryCriteria:
        "IV Rank > 50, IV Percentile > 40, no binary events within DTE, VIX term structure in contango",
      exitCriteria:
        "50% of max profit, 21 DTE (roll or close), or position loss exceeds 2x premium collected",
      maxPositions: "10",
    },
    howItWorks: [
      "Screen the options universe for underlyings with IV Rank above 50 and IV Percentile above 40, confirming volatility is elevated relative to its own history.",
      "Construct delta-neutral strangles with strikes at approximately 16-delta on each side (~1 standard deviation), creating a wide profit zone.",
      "Confirm VIX term structure is in contango (front month < back month) and no binary events (earnings, FDA decisions) fall within the DTE window.",
      "Manage portfolio-level Greeks daily: hedge delta within defined bands, cap aggregate vega exposure, and reduce notional during VIX backwardation.",
      "Close positions at 50% of max profit, at 21 DTE (roll or close), or if position loss exceeds 2x premium collected.",
    ],
    whenToUse: "VRP harvesting thrives during periods of elevated but stable implied volatility, particularly when VIX is in the 18-30 range and term structure is in contango. The strategy performs best when fear is priced in but not materializing -- markets are nervous but not crashing. Avoid during sharp volatility regime transitions (VIX spiking above 35) or when the term structure is deeply inverted, signaling imminent realized vol.",
    risks: [
      "Convex downside: losses during vol spikes can be multiples of premiums collected, and gap moves can breach the strangle strikes instantly.",
      "Correlation risk: during market stress, all short vol positions move against you simultaneously, amplifying portfolio-level drawdown.",
      "Regime change risk: extended low-vol periods can lull the strategy into complacency before a sudden vol expansion.",
      "Liquidity withdrawal: during crisis events, options bid-ask spreads widen dramatically, making it expensive to close losing positions.",
    ],
  },

  "earnings-vol-premium": {
    thesis:
      "This strategy exploits the well-documented tendency of options markets to overestimate the magnitude of earnings-driven price moves. Research by Dubinsky & Johannes (2006) and Gao, Xing & Zhang (2018) demonstrates that at-the-money straddle prices systematically overstate realized post-earnings moves by a median of 20-30%, creating a persistent opportunity for volatility sellers. The strategy sells at-the-money straddles 1-3 days before scheduled earnings announcements, capturing the characteristic IV crush that occurs as the event risk resolves and implied volatility rapidly collapses toward realized levels.\n\nThe theoretical basis for this premium lies in the Peso Problem interpretation of earnings volatility pricing. Market makers, facing the asymmetric risk of occasional extreme earnings reactions, rationally price options to reflect a fat-tailed distribution that incorporates the possibility of 3+ standard deviation moves. However, because these tail events occur in roughly 30% of cases — while the remaining 70% see moves within or below the implied range — the aggregate expected value favors the straddle seller over a large sample. Ederington & Lee (1996) confirm that options implied volatility provides biased forecasts of future volatility around scheduled events, with the bias being most pronounced for high-IV-rank names.\n\nThe strategy is currently paused pending refinement of the underlying selection model and position sizing framework. Historical analysis revealed that while the aggregate win rate is favorable, the distribution of losses is heavy-tailed — the occasional large earnings surprise generates losses that can consume multiple winning trades. Enhancements under development include incorporating historical earnings move accuracy for each underlying, weighting toward names with lower surprise variability, and implementing a portfolio-level straddle-correlation cap to prevent simultaneous losses during earnings season clustering.",
    edge: "Monetizes the systematic overpricing of event-implied volatility around earnings announcements, where market makers embed a fear premium that exceeds realized moves approximately 70% of the time.",
    riskProfile: {
      level: "High",
      description:
        "Naked short straddles carry unlimited theoretical risk on the call side and substantial risk on the put side; a single earnings miss or guidance shock can produce losses far exceeding accumulated premiums.",
    },
    parameters: {
      rebalanceFrequency:
        "Event-driven (1-3 days before scheduled earnings releases)",
      universe:
        "S&P 500 components with weekly options, historical earnings move data of 8+ quarters, and average straddle bid-ask spread < 5% of mid-price",
      positionSizing:
        "0.5-1% of portfolio NAV per straddle, reduced for names with high historical earnings surprise variability",
      entryCriteria:
        "Implied earnings move > 1.3x median historical realized earnings move, IV Rank > 60, no concurrent macro events",
      exitCriteria:
        "Close immediately after earnings release (next trading day open), or intraday if profit exceeds 60% of premium collected pre-announcement",
      maxPositions:
        "8 (currently paused — strategy under review for position sizing refinement)",
    },
    howItWorks: [
      "Scan the earnings calendar for S&P 500 components reporting within 1-3 days that have weekly options with tight bid-ask spreads.",
      "For each candidate, compute the ratio of implied earnings move (ATM straddle price / stock price) to the median historical realized earnings move over the past 8+ quarters.",
      "Enter positions only when the implied/realized ratio exceeds 1.3x and IV Rank is above 60, confirming the vol premium is wide enough.",
      "Sell ATM straddles 1-3 days pre-earnings, sizing at 0.5-1% of NAV per position, with reduced sizing for names with high historical surprise variability.",
      "Close immediately after earnings release (next trading day open) to capture the IV crush, or earlier if intraday profit exceeds 60% of premium collected.",
    ],
    whenToUse: "Best during normal earnings seasons with typical dispersion and no overlapping macro events (FOMC, CPI) that could amplify post-earnings moves. Works well when options markets are pricing in more fear than earnings history justifies. Currently paused -- the strategy needs tighter position sizing to handle the fat-tailed loss distribution from occasional extreme earnings surprises.",
    risks: [
      "Unlimited theoretical risk on the call side of naked short straddles; a single massive earnings beat or miss can erase months of premium income.",
      "Earnings season clustering: multiple concurrent straddles can all lose simultaneously during broad earnings misses, creating concentrated drawdowns.",
      "Guidance risk: even when EPS beats, negative forward guidance can cause outsized moves that exceed the straddle premium.",
      "Regulatory/M&A surprises that coincide with earnings releases, creating moves far outside the implied range.",
    ],
  },

  "regime-adaptive": {
    thesis:
      "This strategy employs a machine-learning-based market regime detection framework to dynamically shift portfolio allocation between risk-on and risk-off positioning. Building on the Hidden Markov Model approach to regime identification pioneered by Hamilton (1989) and extended by Ang & Bekaert (2002), the system classifies the prevailing market environment into three discrete states — bull, bear, and sideways — using a feature set that includes price momentum across multiple timeframes, credit spreads, yield curve shape, breadth indicators, and cross-asset volatility signals. The regime classifier outputs a probability distribution over states, enabling smooth transitions rather than binary switches that generate excessive turnover.\n\nThe academic motivation draws from the extensive literature on time-varying risk premia and the failure of static asset allocation to account for changing market dynamics. Guidolin & Timmermann (2007) demonstrate that regime-switching models significantly improve out-of-sample portfolio performance relative to unconditional allocation strategies. In bull regimes, the strategy increases equity beta exposure through leveraged index positions and concentrated sector bets; in bear regimes, it shifts to a defensive posture emphasizing treasury duration, gold, and low-volatility equities; during sideways or transitional periods, it adopts a neutral stance with emphasis on carry and mean-reversion strategies.\n\nA critical design consideration is the avoidance of overfitting — the primary failure mode of ML-based tactical allocation systems. The regime classifier is trained on expanding windows with walk-forward validation, uses regularization to penalize model complexity, and requires a sustained probability threshold (above 70% for two consecutive weeks) before executing a regime transition. Feature importance is monitored for stability, and the model is periodically retrained with the most recent data to adapt to evolving market microstructure while maintaining structural integrity through a core set of regime-defining indicators.",
    edge: "Captures the time-varying nature of risk premia by systematically identifying macro regime shifts before they are fully reflected in prices, exploiting the lag between leading indicators and the consensus narrative that drives institutional positioning.",
    riskProfile: {
      level: "Medium",
      description:
        "Model risk is the dominant concern — regime misclassification during transitional periods can result in pro-cyclical positioning at inflection points, though probability-based transitions mitigate whipsaw risk.",
    },
    parameters: {
      rebalanceFrequency:
        "Weekly regime assessment with intra-week rebalancing on confirmed regime transitions",
      universe:
        "Multi-asset: US equity indices (SPY, QQQ, IWM), sector ETFs, US Treasuries (TLT, IEF, SHY), gold (GLD), and VIX-linked instruments",
      positionSizing:
        "Risk-parity weighted within regime allocations; overall portfolio volatility targeted at 12% annualized",
      entryCriteria:
        "Regime classifier probability > 70% sustained for 2 consecutive weekly observations, confirmed by at least 3 of 5 macro indicator categories",
      exitCriteria:
        "Regime probability drops below 50% OR competing regime probability exceeds 60%, triggering transition to new allocation",
      maxPositions: "12-18 depending on active regime",
    },
    howItWorks: [
      "Run the HMM regime classifier weekly on a feature set including price momentum (multiple timeframes), credit spreads, yield curve shape, market breadth, and cross-asset volatility.",
      "The classifier outputs a probability distribution over three states: bull, bear, and sideways. A regime transition requires sustained probability above 70% for two consecutive weekly observations.",
      "In bull regime, increase equity beta through leveraged index positions and concentrated sector bets. In bear regime, shift to treasury duration, gold, and low-vol equities. In sideways, adopt carry and mean-reversion positioning.",
      "Confirm regime transitions with at least 3 of 5 macro indicator categories (rates, credit, equity, volatility, breadth) before executing allocation changes.",
      "Rebalance within-regime allocations using risk-parity weighting, targeting 12% annualized portfolio volatility.",
    ],
    whenToUse: "This strategy is designed to adapt to any market environment, but it adds the most value during clear regime transitions -- pivots from bull to bear, or bear to recovery. It outperforms static allocation most during sustained directional markets where regime persistence is high. It may underperform during whipsaw, choppy markets where regimes change faster than the classifier's 2-week confirmation window.",
    risks: [
      "Model risk: regime misclassification at inflection points can result in pro-cyclical positioning (bullish at the top, bearish at the bottom).",
      "Overfitting: ML-based classifiers are prone to finding patterns in noise, though walk-forward validation and regularization mitigate this.",
      "Transition lag: the 2-week confirmation requirement means the strategy is always late to regime changes by design, trading off whipsaw protection for timeliness.",
      "Feature drift: the macro indicators that define regimes may evolve over time (e.g., new Fed framework), requiring periodic model retraining.",
    ],
  },

  "claude-alpha": {
    thesis:
      "Claude Alpha represents a novel approach to systematic equity selection that leverages large language model reasoning as the core analytical engine. Rather than relying on predefined quantitative factors, the strategy uses Claude to perform multi-dimensional analysis of each candidate stock, integrating fundamental data (earnings quality, balance sheet strength, capital allocation efficiency), technical signals (trend structure, volume patterns, relative strength), sentiment indicators (earnings call transcript tone, news flow, social media positioning), and options market signals (unusual flow, put-call skew shifts, term structure anomalies). The synthesis of these heterogeneous data sources into a unified investment thesis for each position mirrors the cognitive process of a skilled discretionary portfolio manager, but with the consistency, scalability, and absence of emotional bias that systematic approaches provide.\n\nThe theoretical basis for this approach draws from the information aggregation literature, particularly Grossman & Stiglitz (1980), who argue that prices cannot fully reflect all available information when information acquisition is costly. A large language model's ability to rapidly process and synthesize vast quantities of unstructured data — earnings transcripts, management commentary, industry reports, macro context — represents a step function reduction in the cost of information processing. This creates an edge in the speed and completeness of fundamental analysis, particularly for mid-cap names where analyst coverage is thinner and informational inefficiencies persist, consistent with the findings of Hong, Lim & Stein (2000) on the relationship between analyst coverage and the speed of price adjustment.\n\nThe strategy maintains epistemic humility by treating Claude's analysis as a sophisticated signal rather than an oracle. Position sizing reflects conviction levels derived from the model's own uncertainty estimates, and all positions are subject to systematic risk management overlays including stop-losses, correlation caps, and sector concentration limits. The approach is inherently adaptive — as the model's training data and reasoning capabilities evolve, the analytical framework improves without requiring manual factor engineering or backtesting of new signals.",
    edge: "Achieves information processing breadth and speed that exceeds human capacity, synthesizing unstructured fundamental, technical, sentiment, and flow data into unified stock-level views — particularly effective in the mid-cap space where analyst coverage gaps create persistent informational inefficiencies.",
    riskProfile: {
      level: "High",
      description:
        "Novel strategy without extensive live track record; model reasoning is not fully interpretable, creating opacity risk in understanding why specific positions are selected during drawdown periods.",
    },
    parameters: {
      rebalanceFrequency: "Weekly analysis with position changes as needed",
      universe:
        "US equities with market cap > $2B, average daily volume > $10M, and sufficient public information for multi-factor analysis",
      positionSizing:
        "Conviction-weighted: 1-3% per position based on Claude's confidence score, with a 5% maximum for highest-conviction ideas",
      entryCriteria:
        "Claude composite score in top quintile across fundamentals, technicals, sentiment, and flow dimensions, with explicit articulation of catalyst and thesis",
      exitCriteria:
        "Thesis invalidation identified by Claude, stop-loss at 8% from entry, or position held > 60 days without catalyst realization",
      maxPositions: "15",
    },
    howItWorks: [
      "Weekly, pull the top screener candidates based on a multi-factor composite score (technical trend structure, fundamental quality, relative strength, and options flow signals).",
      "For each candidate, Claude performs deep analysis: reads recent earnings transcripts, evaluates management commentary, assesses competitive positioning, and checks for sentiment divergence.",
      "Claude generates a conviction-weighted score (0-100) with an explicit articulation of the catalyst and investment thesis for each stock.",
      "Positions are sized based on Claude's confidence: 1-3% per position for standard conviction, up to 5% for highest-conviction ideas, with a maximum of 15 concurrent positions.",
      "Exit management: Claude reviews all positions weekly for thesis invalidation. Hard 8% stop-loss from entry. Maximum 60-day holding period without catalyst realization triggers review.",
    ],
    whenToUse: "Claude Alpha adds the most value in markets with active stock-level dispersion and abundant catalysts -- earnings seasons, sector rotations, and periods of policy uncertainty where fundamental analysis drives returns. It excels in the mid-cap space (market cap $2-10B) where analyst coverage is thinner and informational inefficiencies persist. Less effective during macro-driven, high-correlation environments where all stocks move together.",
    risks: [
      "Novel strategy without extensive live track record; past performance of the analytical framework in backtesting may not predict forward results.",
      "Model opacity: Claude's reasoning is not fully interpretable, making it difficult to understand why specific positions are selected during drawdown periods.",
      "AI model evolution: changes to Claude's reasoning capabilities between versions could alter the strategy's characteristics without explicit calibration.",
      "Concentration risk: if Claude's analysis converges on a narrow set of themes, the portfolio may be less diversified than intended.",
    ],
  },

  "mean-reversion": {
    thesis:
      "This strategy targets short-term mean reversion in fundamentally sound equities that have experienced transient price dislocations. The core premise rests on the overreaction hypothesis formalized by De Bondt & Thaler (1985, 1987), which demonstrates that stocks experiencing sharp declines tend to exhibit subsequent reversals as the initial price move overshoots fundamental value. By conditioning entry on both a technical oversold signal (RSI below 30) and a fundamental quality floor (Piotroski F-Score of 5 or higher), the strategy isolates temporary liquidity-driven dislocations from genuine fundamental deterioration — a critical distinction that separates profitable mean reversion from value traps.\n\nThe quality filter addresses the primary failure mode of naive mean reversion: buying stocks that are cheap for a reason. Stambaugh, Yu & Yuan (2012) show that many apparent mean reversion opportunities are concentrated in low-quality, high-short-interest names where the \"reversion\" never materializes because the price decline reflects rational repricing of impaired fundamentals. By requiring a minimum F-Score, the strategy ensures that purchased stocks have demonstrated profitability, improving leverage ratios, and adequate operating efficiency — characteristics that support the thesis that the current drawdown represents a buying opportunity rather than the beginning of a sustained decline.\n\nThe holding period is deliberately short — positions are closed when RSI recovers above 50 (indicating normalization of selling pressure) or after a maximum of 20 trading days, whichever comes first. This time-boxed approach reflects the empirical evidence from Gutierrez & Kelley (2008) showing that mean reversion in fundamentally sound stocks is a short-duration phenomenon, with the majority of the reversal occurring within the first 15-20 trading days. Extended holding periods dilute returns and introduce exposure to new information that may alter the original thesis.",
    edge: "Exploits the behavioral tendency of market participants to overreact to negative news in fundamentally healthy companies, creating transient mispricings that correct as panic selling subsides and fundamental value reasserts itself.",
    riskProfile: {
      level: "Medium",
      description:
        "Catching falling knives carries inherent timing risk, and systemic market dislocations can push oversold stocks further down before mean reversion materializes, though the quality filter and time stop limit drawdown severity.",
    },
    parameters: {
      rebalanceFrequency:
        "Daily screening with immediate entry on signal confirmation",
      universe:
        "S&P 500 and Russell 1000 constituents with average daily volume > $5M",
      positionSizing:
        "Equal-weight at 3-5% per position, reduced to 2% during periods of elevated market volatility (VIX > 25)",
      entryCriteria:
        "14-day RSI < 30 AND Piotroski F-Score >= 5 AND no pending earnings within 5 trading days AND stock not in a structural downtrend (above 200-day SMA within last 20 days)",
      exitCriteria:
        "RSI recovers above 50 OR 20 trading day maximum holding period OR 10% stop-loss from entry",
      maxPositions: "10",
    },
    howItWorks: [
      "Screen the S&P 500 and Russell 1000 daily for stocks with 14-day RSI below 30, indicating extreme short-term oversold conditions.",
      "Apply a fundamental quality filter: require Piotroski F-Score of 5 or higher to ensure the price decline reflects a temporary dislocation, not genuine deterioration.",
      "Confirm no pending earnings within 5 trading days (to avoid binary event risk) and that the stock was above its 200-day SMA within the last 20 days (eliminating structural downtrends).",
      "Enter qualifying positions at equal weight (3-5% per position, reduced to 2% when VIX > 25) on signal confirmation.",
      "Close when RSI recovers above 50 (mean reversion achieved), at the 20 trading day maximum holding period, or at the 10% stop-loss from entry -- whichever comes first.",
    ],
    whenToUse: "Mean reversion works best during sideways or mildly volatile markets where individual stock dislocations occur against a stable macro backdrop. It excels during sector-specific selloffs (e.g., biotech rotation, bank stress) where the broad market is stable but individual names are temporarily depressed. Avoid during systemic crises where 'oversold' stocks can become much more oversold, and the quality filter alone cannot protect against cascading failures.",
    risks: [
      "Catching falling knives: even with the quality filter, stocks can continue declining if the dislocation is driven by a fundamental change the F-Score hasn't yet captured.",
      "Correlated drawdowns: during broad market selloffs, multiple mean-reversion positions can all move against you simultaneously.",
      "Time decay of the signal: if the stock doesn't revert within 20 days, the mean-reversion thesis weakens and the time stop forces an exit that may be at a loss.",
      "F-Score lag: Piotroski scores are based on annual financial statements and may not reflect recent deterioration in fundamentals.",
    ],
  },

  "vcp-breakout": {
    thesis:
      "The Volatility Contraction Pattern (VCP) strategy systematizes the breakout methodology developed by Mark Minervini, a US Investing Champion, which identifies stocks completing a specific base-building pattern characterized by progressively tightening price ranges and declining volume. The VCP reflects the sequential absorption of overhead supply: each successive contraction represents a wave of selling from trapped holders at lower prices, and the narrowing of volatility signals that the available supply at current levels is being exhausted. When the stock breaks above the pivot point of the final contraction on expanding volume, it indicates a shift in the supply-demand balance that often precedes a sustained advance.\n\nThe theoretical underpinning connects to the microstructure literature on supply and demand zones and the information content of volume. Karpoff (1987) establishes the relationship between volume and price changes, while more recent work by Lo & Wang (2000) on turnover-based asset pricing models supports the thesis that declining volume during consolidation reflects genuine supply absorption rather than disinterest. The VCP pattern can be viewed as an observable manifestation of the accumulation phase described in Wyckoff methodology — sophisticated institutional buyers building positions without disrupting price, creating a coiled-spring setup where breakout above resistance encounters minimal selling pressure.\n\nRisk management is integral to the strategy's edge. Each position is initiated with a predefined 3% stop-loss from the pivot point, ensuring that failed breakouts — which occur in approximately 40-50% of setups depending on market environment — result in small, contained losses. The 10% take-profit target establishes a favorable risk-reward ratio of approximately 3:1, and partial profit-taking at intermediate levels locks in gains while allowing runners to capture extended moves. This asymmetric payoff structure means the strategy can maintain profitability with a win rate below 50%, provided the average winner materially exceeds the average loser — a characteristic confirmed by Minervini's published track record and by O'Neil's (2009) CAN SLIM research on growth stock breakouts.",
    edge: "Identifies the precise moment when selling pressure is exhausted in high-quality growth stocks, entering at the inflection point where supply absorption is complete and incremental demand drives price discovery into uncontested territory above resistance.",
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
    whenToUse: "VCP Breakout requires bull market conditions with clear uptrends and expanding market breadth. It works best during growth-led advances where leading stocks form constructive base patterns. The strategy is most effective in the early-to-mid stages of a market uptrend, when institutional accumulation creates the supply-absorption patterns the VCP identifies. Avoid during bear markets, late-cycle distribution phases, or periods of declining market breadth.",
    risks: [
      "High failure rate: approximately 40-50% of breakouts fail and are stopped out, requiring psychological discipline to accept frequent small losses.",
      "Market regime sensitivity: during bear markets or broad distribution phases, even perfect-looking VCPs fail because there is no institutional demand to absorb supply.",
      "False breakouts on low quality: volume confirmation helps but doesn't eliminate false breakouts driven by momentum ignition or algorithmic activity.",
      "Slippage risk: breakout entries require fast execution, and slippage above the pivot point reduces the risk-reward ratio of each trade.",
    ],
  },

  "pairs-trading": {
    thesis:
      "Pairs trading is a market-neutral statistical arbitrage strategy that exploits temporary mispricings between historically correlated securities. The foundational work by Gatev, Goetzmann & Rouwenhorst (2006) demonstrated that pairs selected using a simple distance-based method generated annualized excess returns of approximately 11% per year, net of transaction costs, with the profits concentrated in the convergence phase of the trade. This strategy employs a more sophisticated cointegration-based approach using the Engle-Granger (1987) two-step method to identify pairs with a stable long-run equilibrium relationship, entering when the spread deviates beyond 2 standard deviations from its mean.\n\nThe market-neutral construction -- simultaneously long the underperformer and short the outperformer in equal dollar amounts -- isolates the relative value signal from broader market movements. This means the strategy's returns are theoretically uncorrelated with equity market direction, making it a valuable portfolio diversifier. The persistence of the pairs trading edge is attributed to several microstructure factors: institutional capital flows create temporary demand/supply imbalances between related stocks, sector rotation driven by macro narratives pushes correlated stocks apart, and idiosyncratic news in one name creates temporary spread dislocations that reliably revert to equilibrium as the fundamental relationship reasserts itself.\n\nA critical innovation in the strategy's implementation is the rolling cointegration test framework. Rather than relying on a static set of cointegrated pairs, the system re-runs the Engle-Granger test monthly on expanding windows, dropping pairs that lose cointegration significance (p > 0.05) and adding newly identified pairs. This adaptive approach, consistent with the findings of Krauss (2017), addresses the primary failure mode of pairs trading: structural regime changes that permanently alter the equilibrium spread between two securities.",
    edge: "Harvests the mean-reverting spread between cointegrated pairs, profiting from temporary dislocations driven by institutional flows and idiosyncratic news while maintaining market neutrality and near-zero beta exposure.",
    riskProfile: {
      level: "Low",
      description:
        "Market-neutral construction limits directional exposure, but spread blow-outs from structural regime changes or pair decoupling can generate outsized losses if stops are not respected.",
    },
    parameters: {
      rebalanceFrequency: "Daily z-score monitoring with immediate entry on threshold breach",
      universe: "S&P 500 sector pairs with 2+ year cointegration history (Engle-Granger p < 0.05)",
      positionSizing: "Equal dollar long/short per pair, 3-5% of NAV per pair position",
      entryCriteria: "Z-score > 2.0 or < -2.0 on the cointegrated spread",
      exitCriteria: "Z-score crosses 0 (mean reversion) or stop at z-score > 3.5 (spread blow-out)",
      maxPositions: "8",
    },
    howItWorks: [
      "Run monthly cointegration tests (Engle-Granger two-step method) across all within-sector stock pairs in the S&P 500, requiring p < 0.05 on a 2+ year lookback window.",
      "For qualifying pairs, compute the cointegrating regression to establish the hedge ratio, then calculate the spread (residual) and its rolling z-score.",
      "Monitor z-scores daily. When a pair's z-score breaches +/- 2.0, enter the trade: go long the underperformer, short the outperformer, in equal dollar amounts using the hedge ratio.",
      "Hold the position until the z-score crosses 0 (mean reversion target achieved) or exits are triggered at z-score > 3.5 (spread blow-out stop).",
      "Drop pairs that lose cointegration significance at the monthly re-test, and add newly qualifying pairs to the watchlist.",
    ],
    whenToUse: "Pairs trading works across all market regimes because it is direction-agnostic. It excels during periods of elevated sector dispersion, where correlated stocks within the same industry temporarily diverge due to idiosyncratic catalysts. Performance is strongest in normal volatility environments (VIX 15-25) where mean-reversion dynamics are reliable. Avoid during structural regime changes (industry disruption, regulatory shifts) that can permanently alter pair relationships.",
    risks: [
      "Pair decoupling: structural changes (M&A, fundamental deterioration, industry disruption) can permanently break the cointegration relationship, turning a mean-reverting spread into a trending one.",
      "Short squeeze risk on the short leg: if the overperformer experiences a short squeeze, the loss on the short side can exceed the gain on the long side.",
      "Convergence timing: even when pairs eventually revert, the holding period can be longer than expected, tying up capital and requiring margin maintenance.",
      "Transaction costs: frequent rebalancing to maintain the hedge ratio and entering/exiting pairs generates costs that can erode the edge, especially in less liquid names.",
    ],
  },

  "dividend-capture": {
    thesis:
      "The dividend capture strategy systematically harvests dividend payments by entering positions shortly before the ex-dividend date and exiting shortly after. The theoretical framework rests on the ex-dividend day pricing anomaly first documented by Elton & Gruber (1970), who showed that stock prices do not fully adjust by the dividend amount on the ex-date. Subsequent research by Frank & Jagannathan (1998) and Graham, Michaely & Roberts (2003) confirmed that the average ex-date price drop is approximately 80-90% of the dividend amount, creating a small but consistent capture opportunity when combined with the actual dividend income.\n\nThe strategy screens for stocks with dividend yields above 3%, adequate daily liquidity (> $10M ADV), positive 20-day momentum, and Piotroski F-Score of 5 or higher to avoid value traps. The momentum filter is critical -- it ensures entry into dividend stocks that are in a supportive technical environment, which increases the probability of rapid price recovery after the ex-date drop. Research by Hartzmark & Solomon (2013) demonstrates that dividend-paying stocks experience predictable demand patterns around ex-dates, with buying pressure building before the ex-date and selling pressure immediately after, creating a systematic pattern the strategy can exploit.\n\nThe quality filter (F-Score >= 5) serves to eliminate stocks that are high-yielding because of fundamental deterioration -- the classic dividend yield trap where a declining stock price inflates the yield, luring income-seeking investors into deteriorating businesses. By requiring minimum financial health, the strategy targets genuine income generators whose dividends are sustainable and whose price recovery after the ex-date is supported by solid fundamentals.",
    edge: "Captures reliable dividend income from high-quality stocks while momentum and quality filters minimize ex-date price drop risk, exploiting the empirically documented tendency of ex-date price adjustments to be less than the full dividend amount.",
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
    whenToUse: "Dividend capture performs best during stable-to-bullish market environments where high-quality income stocks maintain their uptrends. The strategy is most effective in low-volatility periods (VIX < 20) where the ex-date price drop is small relative to the dividend, and recovery is swift. It also works well during rate-cutting cycles when demand for dividend stocks increases. Avoid during high-volatility market environments where the ex-date drop can be amplified by broader selling pressure.",
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
    edge: "Rides sector-level momentum driven by macro themes, business cycle dynamics, and institutional capital flows, exploiting the persistence of sector leadership that is stronger and less crash-prone than individual stock momentum.",
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
    whenToUse: "Sector rotation excels during sustained economic trends where sector leadership persists for multiple months -- early-to-mid business cycle expansions (overweight cyclicals), late-cycle tightening (overweight defensives), and recovery phases (overweight rate-sensitive sectors). It adds the most value when macro themes are clear and institutional flows are directional. Avoid during rapid, unpredictable sector rotations (e.g., tariff whiplash, sudden policy reversals) where monthly rebalancing is too slow to capture the shift.",
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
    edge: "Fades exaggerated overnight gaps in liquid stocks, profiting from the reliable tendency of pre-market dislocations to revert as the full regular-session order book absorbs the overnight information asymmetry.",
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
    whenToUse: "Gap fill works best during normal-volatility market environments (VIX 12-22) where overnight gaps are driven by noise, pre-market algorithmic activity, or minor news rather than genuine catalysts. The strategy excels on days with low macro event risk (no FOMC, no CPI) where the opening auction normalizes overnight dislocations efficiently. Currently paused pending implementation of a catalyst-screening layer.",
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
    edge: "Combines human intuition and market awareness with AI-powered post-trade analysis, creating a feedback loop that systematically identifies and corrects behavioral trading biases over time.",
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
    whenToUse: "Use for trades driven by personal conviction, breaking news events, hedging needs, or opportunistic entries that don't fit systematic strategy criteria. Best used sparingly -- research shows that traders who trade less frequently outperform those who overtrade. Each discretionary trade should have an explicit thesis that can be evaluated after the fact.",
    risks: [
      "Behavioral biases: overconfidence, disposition effect, anchoring, and recency bias all disproportionately affect discretionary trading decisions.",
      "Lack of predefined exits: without systematic stop-losses and targets, losses can compound and winners can be cut short.",
      "Portfolio concentration: discretionary trades may inadvertently cluster in correlated sectors or themes, creating hidden concentration risk.",
      "Performance drag: academic evidence consistently shows that discretionary trading, on average, underperforms systematic approaches due to emotional decision-making.",
    ],
  },
};
