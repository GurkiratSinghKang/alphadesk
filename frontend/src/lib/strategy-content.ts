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
  },
};
