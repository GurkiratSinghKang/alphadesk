import type { Metadata } from "next";

import MarketingShell from "@/components/layouts/MarketingShell";
import Display from "@/components/typography/Display";
import SectionRule from "@/components/typography/SectionRule";

export const metadata: Metadata = {
  title: "Earnings Data Guide - AlphaDesk",
  description:
    "How AlphaDesk builds the earnings options play view, including providers, delayed fields, AI research, and trading limitations.",
};

const SECTIONS = [
  {
    tag: "01 · Inputs",
    title: "What feeds the earnings options play",
    body: [
      "The earnings calendar, EPS and revenue estimates, reported surprises, and prior earnings dates come from Financial Modeling Prep. AlphaDesk filters that calendar to liquid US-listed symbols before it hydrates each candidate.",
      "Quotes, historical daily bars, and options-chain context come from Alpaca where available. When a live options chain is unavailable, the strategy marks the chain as synthetic instead of presenting it as executable market data.",
      "News headlines are fetched from the configured news provider and scored for recency, sentiment, and relevance to the selected ticker.",
    ],
  },
  {
    tag: "02 · Derived Fields",
    title: "How the dashboard calculates context",
    body: [
      "Expected move is based on the front earnings-cycle options context when the chain is available. Historical earnings move is computed from prior FMP earnings dates joined to adjusted daily bars, using the close before the report and the next available trading-session close.",
      "Premium yield compares option mid prices to the underlying price for near-the-money calls and puts. It is a screening clue, not a fill estimate.",
      "Beat rate uses the available surprise history. If the provider does not return enough clean historical surprises, the field is left blank rather than backfilled with a guess.",
    ],
  },
  {
    tag: "03 · AI Research",
    title: "When Claude analysis appears",
    body: [
      "The structured thesis is generated and cached per symbol and report date after the calendar row is hydrated. It can be unavailable when the AI provider times out, a budget limit trips, or upstream data is too thin.",
      "Full research is a user-triggered note that uses the available quote, options, historical earnings, and news context. It may still run even when the structured thesis is missing.",
      "AI output is research context only. It is not an order instruction, and every order still needs to pass the ticket, broker, and risk checks.",
    ],
  },
  {
    tag: "04 · Trading Limits",
    title: "What the data does not guarantee",
    body: [
      "Options prices can move quickly around earnings, and displayed mid prices can differ from executable fills. Wide markets, halts, stale quotes, and after-hours reports can all change the realized trade.",
      "BMO and AMC timing depends on provider calendar metadata and can change. Confirm the company's investor-relations release time before placing a live earnings trade.",
      "AlphaDesk is not a broker-dealer or investment adviser. Use paper trading while validating a strategy and size live options risk conservatively.",
    ],
  },
];

export default function EarningsDataHelpPage() {
  return (
    <MarketingShell route="/help/earnings-data">
      <article className="mx-auto max-w-[780px] py-16">
        <Display size="lg" as="h1">
          Earnings Data Guide
        </Display>
        <p className="mt-4 font-sans text-numeric-md leading-relaxed text-fg-dim">
          A practical map of the data behind the earnings options play: where
          the fields come from, which values are estimates, and what to verify
          before using the trade ticket.
        </p>

        <div className="mt-12 flex flex-col gap-12">
          {SECTIONS.map((section) => (
            <section key={section.tag}>
              <SectionRule tag={`§ ${section.tag}`} />
              <h2 className="mt-5 font-display text-h2 italic text-fg">
                {section.title}
              </h2>
              <div className="mt-4 flex flex-col gap-4">
                {section.body.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="font-sans text-body leading-relaxed text-fg-dim"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </article>
    </MarketingShell>
  );
}
