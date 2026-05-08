import type { Metadata } from "next";
import Link from "next/link";

import MarketingShell from "@/components/layouts/MarketingShell";
import Section from "@/components/composites/Section";
import StatusBanner from "@/components/composites/StatusBanner";
import AgentChip from "@/components/primitives/AgentChip";

export const metadata: Metadata = {
  title: "v2 redesign — AlphaDesk Docs",
  description:
    "What changed in v2: agents as protagonist, granular Admin Control Center, warm-paper light theme, editorial voice.",
};

/**
 * Phase 3 — Public docs sample article. Renders the v2 primitives
 * (Section, AgentChip, StatusBanner) in an editorial-quiet context
 * so readers experience the design language while learning what
 * changed. Linked from the main /docs page in a follow-up.
 */
export default function V2DocsArticle() {
  return (
    <MarketingShell route="/docs/v2">
      <article className="mx-auto max-w-[760px] py-16 space-y-10">
        <Section
          eyebrow="DOCS · V2 REDESIGN"
          title="What changed in v2"
          description="Agents as protagonist · granular Admin Control Center · warm-paper light theme · editorial voice."
          level={1}
        />

        <StatusBanner
          tone="info"
          message="v2 ships incrementally behind feature flags. Most surfaces are live as of this article; backend extensions (B.1–B.18) are tracked separately."
        />

        <Section
          eyebrow="THE FRAME"
          title="Agents as protagonist"
          description="Four archetypes — frozen taxonomy, opinionated voice."
        >
          <div className="flex flex-wrap gap-2">
            <AgentChip archetype="research" hideStatus size="lg" />
            <AgentChip archetype="signal" hideStatus size="lg" />
            <AgentChip archetype="risk" hideStatus size="lg" />
            <AgentChip archetype="exec" hideStatus size="lg" />
          </div>
          <p className="font-display italic text-body text-fg-dim leading-relaxed">
            Every AI surface in v2 is attributed to one of four archetypes.
            Generic &ldquo;AI memo&rdquo; copy is being replaced with archetype voice
            (&ldquo;Research thinks the regime is fragile,&rdquo; &ldquo;Risk flagged sector
            concentration&rdquo;). Phase 2 weaves this attribution across every
            page — Dashboard hero, Symbol page, Strategy playbook, Position
            rows, Trade pre-execution stamps.
          </p>
        </Section>

        <Section
          eyebrow="THE CONTROL"
          title="Admin Control Center"
          description="Single command surface · 60+ ControlModules · ⌘⇧J Jarvis intent bar."
        >
          <p className="text-body text-fg-dim leading-relaxed">
            The Admin → Control Center exposes every knob in the system as a
            granular <code className="font-mono text-label bg-bg-elev-1 px-1 py-0.5 rounded-sm">{"<ControlModule>"}</code>{" "}
            card &mdash; per-stage pipeline pause, per-agent spend cap,
            per-strategy enable, per-flag toggle, key rotation, deploy
            dispatch. Search across the entire registry via <kbd className="font-mono text-label bg-bg-elev-1 px-1.5 py-0.5 rounded-sm border border-border-hair">⌘⇧J</kbd>{" "}
            (Jarvis bar). Health tile row at the top of the page summarizes the
            posture; click any tile to scroll into the matching module.
          </p>
        </Section>

        <Section
          eyebrow="THE VOICE"
          title="Editorial-quiet"
          description="Italic Newsreader display · warm-paper light theme · no neon · brand uses sparingly."
        >
          <p className="font-display italic text-body text-fg-dim leading-relaxed">
            v2 sets editorial-quiet as the default visual rhythm. Sections lead
            with a tracked-caps eyebrow in brand color, an italic Newsreader
            display title, and a hairline rule. The light theme replaces the
            former porcelain palette with warm-paper (cream surfaces · warm-
            brown brand · moss/rust earth-tone P&amp;L). Active traders can opt
            into dense via Settings → Appearance.
          </p>
        </Section>

        <Section
          eyebrow="THE GUARANTEE"
          title="Preservation register"
          description="50+ load-bearing optimizations preserved."
        >
          <p className="text-body text-fg-dim leading-relaxed">
            Every v2 PR is reviewed against the{" "}
            <code className="font-mono text-label bg-bg-elev-1 px-1 py-0.5 rounded-sm">PRESERVATION-REGISTER.md</code>{" "}
            document. The five highest-risk invariants &mdash; cross-tab tradingMode
            sync, WebSocket resume cursors, the chart{" "}
            <code className="font-mono text-label bg-bg-elev-1 px-1 py-0.5 rounded-sm">fitContent</code>{" "}
            gate, the destructive-modal pattern, and the stale-quote 422
            auto-refresh &mdash; are encoded as test gates. lightweight-charts is
            the canonical chart engine; v2 overlays land as series-primitive
            plugins on top, never as SVG rewrites.
          </p>
        </Section>

        <p className="text-body text-fg-muted italic pt-8 border-t border-border-hair">
          Read the implementation plan at{" "}
          <Link href="/docs" className="underline-offset-2 hover:underline text-brand">
            /docs
          </Link>{" "}
          or open the{" "}
          <Link
            href="/admin/control-center"
            className="underline-offset-2 hover:underline text-brand"
          >
            Control Center
          </Link>{" "}
          to see the v2 surface in context.
        </p>
      </article>
    </MarketingShell>
  );
}
