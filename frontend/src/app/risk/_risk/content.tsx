import type { StaticClause } from "@/components/layouts/StaticArticle";
import {
  EditorialBullet,
  EditorialP,
  MailA,
} from "@/components/layouts/editorial";

export const RISK_CLAUSES: StaticClause[] = [
  {
    index: "01",
    title: "General trading risks",
    body: (
      <ul className="space-y-3">
        <EditorialBullet>
          The value of securities can fluctuate significantly, and you may lose
          some or all of your invested capital.
        </EditorialBullet>
        <EditorialBullet>
          Leveraged and margin trading amplifies both potential gains and
          losses.
        </EditorialBullet>
        <EditorialBullet>
          Market liquidity can vary, and you may not be able to exit positions
          at desired prices.
        </EditorialBullet>
        <EditorialBullet>
          System outages, network issues, or brokerage downtime may prevent you
          from managing positions during critical periods.
        </EditorialBullet>
        <EditorialBullet>
          Slippage between expected and executed prices can occur, especially
          in volatile markets.
        </EditorialBullet>
      </ul>
    ),
  },
  {
    index: "02",
    title: "Options trading risks",
    body: (
      <ul className="space-y-3">
        <EditorialBullet>
          Options trading carries a high degree of risk and is not appropriate
          for all investors.
        </EditorialBullet>
        <EditorialBullet>
          Buyers of options may lose the entire premium paid.
        </EditorialBullet>
        <EditorialBullet>
          Sellers of options may face unlimited loss potential (naked calls) or
          substantial losses (puts and covered strategies).
        </EditorialBullet>
        <EditorialBullet>
          Complex multi-leg strategies carry unique risks including execution
          risk and margin requirements.
        </EditorialBullet>
        <EditorialBullet>
          Options are time-decaying assets; their value erodes as expiration
          approaches.
        </EditorialBullet>
        <EditorialBullet>
          Early assignment risk exists for American-style options.
        </EditorialBullet>
      </ul>
    ),
  },
  {
    index: "03",
    title: "Past performance disclaimer",
    body: (
      <EditorialP>
        Past performance of any strategy, algorithm, or trading system is not
        indicative of future results. Historical backtests and paper trading
        results do not account for all real-world factors including slippage,
        market impact, and liquidity constraints. Hypothetical performance
        results have inherent limitations and should not be relied upon as
        indicators of future performance.
      </EditorialP>
    ),
  },
  {
    index: "04",
    title: "Paper vs. live trading",
    body: (
      <>
        <EditorialP>
          AlphaDesk supports both paper (simulated) and live trading modes.
          You should be aware that:
        </EditorialP>
        <ul className="mt-4 space-y-3">
          <EditorialBullet>
            Paper trading results may differ significantly from live trading
            due to the absence of real market impact, slippage, and partial
            fills.
          </EditorialBullet>
          <EditorialBullet>
            Emotional and psychological factors present in live trading are
            absent in paper trading.
          </EditorialBullet>
          <EditorialBullet>
            Successful paper trading performance does not guarantee successful
            live trading.
          </EditorialBullet>
          <EditorialBullet>
            Ensure you are connected to the correct environment (paper vs.
            live) before executing trades.
          </EditorialBullet>
        </ul>
      </>
    ),
  },
  {
    index: "05",
    title: "No investment advice",
    body: (
      <>
        <EditorialP>
          AlphaDesk does not provide investment advice, tax advice, or
          financial planning services. The platform is a software tool that
          facilitates trading and analysis. Any information provided by the
          platform, including AI-generated analysis, is for informational
          purposes only and should not be construed as a recommendation to
          buy, sell, or hold any security.
        </EditorialP>
        <div className="mt-3">
          <EditorialP>
            You should consult with a qualified financial advisor before making
            any investment decisions.
          </EditorialP>
        </div>
      </>
    ),
  },
  {
    index: "06",
    title: "AI-generated analysis disclaimer",
    body: (
      <>
        <EditorialP>
          AlphaDesk uses Anthropic&rsquo;s Claude AI to generate market
          analysis, trade ideas, and strategy recommendations. You should
          understand that:
        </EditorialP>
        <ul className="mt-4 space-y-3">
          <EditorialBullet>
            AI-generated analysis may contain errors, inaccuracies, or
            hallucinations.
          </EditorialBullet>
          <EditorialBullet>
            AI models have knowledge cutoff dates and may not reflect the most
            current market conditions or events.
          </EditorialBullet>
          <EditorialBullet>
            AI analysis does not constitute professional financial advice.
          </EditorialBullet>
          <EditorialBullet>
            The AI may not fully understand your personal financial situation,
            risk tolerance, or investment objectives.
          </EditorialBullet>
          <EditorialBullet>
            You should independently verify all AI-generated information before
            acting on it.
          </EditorialBullet>
          <EditorialBullet>
            Automated strategy execution based on AI signals carries additional
            risk of unintended trades.
          </EditorialBullet>
        </ul>
      </>
    ),
  },
  {
    index: "07",
    title: "Regulatory notice",
    body: (
      <EditorialP>
        AlphaDesk is not a registered broker-dealer, investment adviser, or
        financial institution. Securities trading is facilitated through Alpaca
        Securities LLC, a registered broker-dealer and member of FINRA/SIPC.
        Alpaca&rsquo;s terms, disclosures, and regulatory status govern the
        brokerage relationship.
      </EditorialP>
    ),
  },
  {
    index: "08",
    title: "Pattern day trader (PDT) rule",
    body: (
      <EditorialP>
        Accounts with less than $25,000 making 4+ day trades in 5 business days
        may be flagged as pattern day traders, restricting trading activity.
      </EditorialP>
    ),
  },
  // P85-3 — PFOF disclosure. Required by SEC Rule 606 transparency expectations
  // that introducing brokers disclose PFOF practices of their executing broker.
  // AlphaDesk itself does not receive PFOF; Alpaca may.
  {
    index: "08a",
    title: "How your orders are executed",
    body: (
      <EditorialP>
        Alpaca Securities LLC is our executing broker. Alpaca may receive
        payment for order flow (PFOF) from market makers. This is a common
        U.S. industry practice permitted by the SEC. Alpaca publishes a
        quarterly SEC Rule 606 report at{" "}
        <a
          href="https://alpaca.markets/disclosures"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 decoration-dotted hover:text-primary"
        >
          alpaca.markets/disclosures
        </a>
        . AlphaDesk does not negotiate for, request, or receive PFOF. Past
        execution quality does not guarantee future execution quality.
      </EditorialP>
    ),
  },
  {
    index: "09",
    title: "Counterparty risk",
    body: (
      <EditorialP>
        AlphaDesk relies on Alpaca Securities LLC as its executing broker.
        Alpaca is a member of FINRA/SIPC. Your securities are protected up to
        $500,000 by SIPC.
      </EditorialP>
    ),
  },
  {
    index: "10",
    title: "Tax implications",
    body: (
      <EditorialP>
        Trading profits are subject to capital gains tax. Consult a tax
        professional. AlphaDesk does not provide tax advice.
      </EditorialP>
    ),
  },
  {
    index: "11",
    title: "Order execution risk",
    body: (
      <EditorialP>
        Market orders execute at the next available price, which may differ
        from the displayed price. Limit orders may not fill if the price target
        is not reached.
      </EditorialP>
    ),
  },
  {
    index: "12",
    title: "Contact",
    body: (
      <EditorialP>
        For questions about this risk disclosure, contact us at{" "}
        <MailA address="legal@tradingalpha.net" />.
      </EditorialP>
    ),
  },
];
