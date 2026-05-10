import type { Metadata } from "next";
import Link from "next/link";

import Section from "@/components/composites/Section";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing — AlphaDesk",
  description:
    "AlphaDesk plan tiers — Free / Starter / Pro / Operator. Multi-tenant access starting in v2.",
};

interface PricingTier {
  id: string;
  name: string;
  price: string;
  cadence: string;
  pitch: string;
  features: string[];
  cta: { label: string; href: string };
  highlight?: boolean;
}

const TIERS: PricingTier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "forever",
    pitch: "Paper trading + dashboard. Verify the workflow before you commit.",
    features: [
      "Paper account · Alpaca sandbox",
      "Dashboard · 3 active strategies",
      "Pooled AI · 50 agent runs / day",
      "Watchlists · 1 list, ~30 names",
      "Reports · monthly P&L view",
    ],
    cta: { label: "Apply for access", href: "/request-access" },
  },
  {
    id: "starter",
    name: "Starter",
    price: "$49",
    cadence: "/ month",
    pitch: "Solo trader. One broker. Full agent suite.",
    features: [
      "Live trading · single broker",
      "All strategies · per-strategy capital cap",
      "Pooled AI · 200 agent runs / day",
      "Watchlists · 5 lists + per-strategy auto",
      "Reports · weekly + monthly + tax export",
      "Email alerts · per-rule routing",
    ],
    cta: { label: "Apply for access", href: "/request-access" },
  },
  {
    id: "pro",
    name: "Pro",
    price: "$199",
    cadence: "/ month",
    pitch: "Active trader. Multi-broker. BYO key option.",
    features: [
      "Live trading · multi-broker",
      "All strategies · per-tenant override",
      "BYO AI provider key OR pooled AI · 1000 runs / day",
      "Unlimited watchlists · public sharing",
      "Reports · daily + AI summary + 8949 export",
      "Slack + email + push alerts",
      "Backtest workbench · param sweep + compare",
    ],
    cta: { label: "Apply for access", href: "/request-access" },
    highlight: true,
  },
  {
    id: "operator",
    name: "Operator",
    price: "Custom",
    cadence: "single seat",
    pitch: "The desk. Single operator. Everything granular.",
    features: [
      "Admin Control Center · 60+ runtime modules",
      "Admin Users · approve / impersonate / bulk",
      "Per-user override on every limit",
      "Deploy dispatch · staging + prod",
      "Audit log · 90-day retention",
      "Jarvis (⌘⇧J) · conversational command bar",
    ],
    cta: { label: "Contact operator", href: "/contact" },
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-dvh bg-bg px-6 py-12">
      <div className="max-w-6xl mx-auto space-y-8">
        <Section
          eyebrow="PRICING"
          title="Plans for every kind of trader"
          description="Free for paper · Starter for solo · Pro for serious · Operator for the desk."
          level={1}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {TIERS.map((tier) => (
            <article
              key={tier.id}
              className={cn(
                "relative rounded-md border p-5 flex flex-col gap-4",
                tier.highlight
                  ? "border-brand/60 bg-tint-brand-1 shadow-[0_24px_60px_-40px_var(--brand)]"
                  : "border-border-hair bg-bg-elev-1",
              )}
            >
              {tier.highlight && (
                <span className="absolute -top-2 right-4 px-2 py-0.5 rounded-pill bg-brand text-brand-on text-eyebrow font-semibold uppercase tracking-[0.08em]">
                  Most flexible
                </span>
              )}
              <header>
                <h3 className="font-display italic text-h2 text-fg">{tier.name}</h3>
                <p className="text-body-sm text-fg-muted leading-snug mt-1">{tier.pitch}</p>
                <p className="mt-3">
                  <span className="t-num-xl text-fg">{tier.price}</span>
                  <span className="text-body-sm text-fg-muted ml-2">{tier.cadence}</span>
                </p>
              </header>
              <ul className="text-body-sm text-fg-dim space-y-1.5 list-none flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="text-profit mt-0.5" aria-hidden>✓</span>
                    <span className="leading-snug">{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={tier.cta.href}
                className={cn(
                  "inline-flex w-full items-center justify-center rounded-sm px-3 py-2 text-body font-semibold uppercase tracking-[0.08em] transition-colors",
                  tier.highlight
                    ? "bg-brand text-brand-on hover:bg-brand-dim"
                    : "border border-brand/40 text-brand hover:bg-tint-brand-1",
                )}
              >
                {tier.cta.label}
              </Link>
            </article>
          ))}
        </div>

        <Section eyebrow="FAQ" title="Common questions">
          <dl className="space-y-4 text-body">
            <div>
              <dt className="font-semibold text-fg">Is live trading really admin-gated?</dt>
              <dd className="text-fg-dim mt-1 leading-relaxed">Yes. Live posture requires explicit operator approval in Phase 1; the multi-tenant write path is stricter than the read path. Paper trading is unrestricted.</dd>
            </div>
            <div>
              <dt className="font-semibold text-fg">What happens to my key if I downgrade?</dt>
              <dd className="text-fg-dim mt-1 leading-relaxed">Pro&apos;s BYO AI provider key is encrypted at rest. On downgrade we delete the encrypted blob within 24h; the spend cap reverts to the pooled key for your tier.</dd>
            </div>
            <div>
              <dt className="font-semibold text-fg">Are tax reports CPA-ready?</dt>
              <dd className="text-fg-dim mt-1 leading-relaxed">Reports + Tax/Lots are <em>informational</em>. We export 8949 / TurboTax-TXF formats and apply IRS Pub 550 30-day wash-sale rules for equity. Always confirm with your CPA before filing.</dd>
            </div>
          </dl>
        </Section>
      </div>
    </main>
  );
}
