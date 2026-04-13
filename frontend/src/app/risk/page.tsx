import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Risk Disclosure — AlphaDesk",
  description: "AlphaDesk risk disclosure: trading risks, AI analysis disclaimers, and important warnings.",
};

export default function RiskDisclosurePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <nav className="mb-8">
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; Back to AlphaDesk
          </Link>
        </nav>

        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Risk Disclosure
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated: April 12, 2026
        </p>

        <div className="mt-6 rounded-xl border border-[var(--loss)]/30 bg-[var(--loss)]/5 p-4">
          <p className="text-sm font-medium text-[var(--loss)]">
            Trading securities and options involves substantial risk of loss and
            is not suitable for all investors. You should carefully consider
            whether trading is appropriate for you in light of your financial
            condition.
          </p>
        </div>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              1. General Trading Risks
            </h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                The value of securities can fluctuate significantly, and you may
                lose some or all of your invested capital.
              </li>
              <li>
                Leveraged and margin trading amplifies both potential gains and
                losses.
              </li>
              <li>
                Market liquidity can vary, and you may not be able to exit
                positions at desired prices.
              </li>
              <li>
                System outages, network issues, or brokerage downtime may
                prevent you from managing positions during critical periods.
              </li>
              <li>
                Slippage between expected and executed prices can occur,
                especially in volatile markets.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              2. Options Trading Risks
            </h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Options trading carries a high degree of risk and is not
                appropriate for all investors.
              </li>
              <li>
                Buyers of options may lose the entire premium paid.
              </li>
              <li>
                Sellers of options may face unlimited loss potential (naked
                calls) or substantial losses (puts and covered strategies).
              </li>
              <li>
                Complex multi-leg strategies carry unique risks including
                execution risk and margin requirements.
              </li>
              <li>
                Options are time-decaying assets; their value erodes as
                expiration approaches.
              </li>
              <li>
                Early assignment risk exists for American-style options.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              3. Past Performance Disclaimer
            </h2>
            <p>
              Past performance of any strategy, algorithm, or trading system is
              not indicative of future results. Historical backtests and paper
              trading results do not account for all real-world factors
              including slippage, market impact, and liquidity constraints.
              Hypothetical performance results have inherent limitations and
              should not be relied upon as indicators of future performance.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              4. Paper vs. Live Trading
            </h2>
            <p>
              AlphaDesk supports both paper (simulated) and live trading modes.
              You should be aware that:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Paper trading results may differ significantly from live
                trading due to the absence of real market impact, slippage, and
                partial fills.
              </li>
              <li>
                Emotional and psychological factors present in live trading are
                absent in paper trading.
              </li>
              <li>
                Successful paper trading performance does not guarantee
                successful live trading.
              </li>
              <li>
                Ensure you are connected to the correct environment (paper vs.
                live) before executing trades.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              5. No Investment Advice
            </h2>
            <p>
              AlphaDesk does not provide investment advice, tax advice, or
              financial planning services. The platform is a software tool that
              facilitates trading and analysis. Any information provided by the
              platform, including AI-generated analysis, is for informational
              purposes only and should not be construed as a recommendation to
              buy, sell, or hold any security.
            </p>
            <p className="mt-2">
              You should consult with a qualified financial advisor before
              making any investment decisions.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              6. AI-Generated Analysis Disclaimer
            </h2>
            <p>
              AlphaDesk uses Anthropic&apos;s Claude AI to generate market
              analysis, trade ideas, and strategy recommendations. You should
              understand that:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                AI-generated analysis may contain errors, inaccuracies, or
                hallucinations.
              </li>
              <li>
                AI models have knowledge cutoff dates and may not reflect the
                most current market conditions or events.
              </li>
              <li>
                AI analysis does not constitute professional financial advice.
              </li>
              <li>
                The AI may not fully understand your personal financial
                situation, risk tolerance, or investment objectives.
              </li>
              <li>
                You should independently verify all AI-generated information
                before acting on it.
              </li>
              <li>
                Automated strategy execution based on AI signals carries
                additional risk of unintended trades.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              7. Regulatory Notice
            </h2>
            <p>
              AlphaDesk is not a registered broker-dealer, investment adviser,
              or financial institution. Securities trading is facilitated
              through Alpaca Securities LLC, a registered broker-dealer and
              member of FINRA/SIPC. Alpaca&apos;s terms, disclosures, and
              regulatory status govern the brokerage relationship.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              8. Pattern Day Trader (PDT) Rule
            </h2>
            <p>
              Accounts with less than $25,000 making 4+ day trades in 5 business
              days may be flagged as pattern day traders, restricting trading
              activity.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              9. Counterparty Risk
            </h2>
            <p>
              AlphaDesk relies on Alpaca Securities LLC as its executing broker.
              Alpaca is a member of FINRA/SIPC. Your securities are protected up
              to $500,000 by SIPC.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              10. Tax Implications
            </h2>
            <p>
              Trading profits are subject to capital gains tax. Consult a tax
              professional. AlphaDesk does not provide tax advice.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              11. Order Execution Risk
            </h2>
            <p>
              Market orders execute at the next available price, which may differ
              from the displayed price. Limit orders may not fill if the price
              target is not reached.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              12. Contact
            </h2>
            <p>
              For questions about this risk disclosure, contact us at{" "}
              <a
                href="mailto:legal@tradingalpha.net"
                className="text-primary hover:underline"
              >
                legal@tradingalpha.net
              </a>
              .
            </p>
          </section>
        </div>

        <footer className="mt-16 border-t border-border/30 pt-6">
          <nav className="flex gap-4 text-xs text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms of Service
            </Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
