/**
 * Design preview (dev-only).
 *
 * Route: /_design
 * Purpose: eyeball the F0 token + type foundation.
 * NOT linked from navigation.
 */

const SWATCHES: Array<{ name: string; bg: string; text: string }> = [
  { name: "bg-bg", bg: "bg-bg", text: "text-fg" },
  { name: "bg-bg-elev-1", bg: "bg-bg-elev-1", text: "text-fg" },
  { name: "bg-bg-elev-2", bg: "bg-bg-elev-2", text: "text-fg" },
  { name: "bg-bg-card", bg: "bg-bg-card", text: "text-fg" },
  { name: "bg-brand", bg: "bg-brand", text: "text-ink-1000" },
  { name: "bg-brand-dim", bg: "bg-brand-dim", text: "text-ink-1000" },
  { name: "bg-profit", bg: "bg-profit", text: "text-ink-050" },
  { name: "bg-loss", bg: "bg-loss", text: "text-ink-050" },
  { name: "bg-ice", bg: "bg-ice", text: "text-ink-050" },
  { name: "bg-wine", bg: "bg-wine", text: "text-ink-1000" },
  { name: "bg-amber", bg: "bg-amber", text: "text-ink-050" },
  { name: "bg-ink-200", bg: "bg-ink-200", text: "text-fg" },
  { name: "bg-ink-300", bg: "bg-ink-300", text: "text-fg" },
  { name: "bg-gold-300", bg: "bg-gold-300", text: "text-ink-050" },
];

const SEMANTIC_CLASSES: Array<{ cls: string; sample: string }> = [
  { cls: "t-display-xl", sample: "Quiet money" },
  { cls: "t-display-lg", sample: "loud math" },
  { cls: "t-display-md", sample: "Strategy detail" },
  { cls: "t-h1", sample: "Heading one" },
  { cls: "t-h2", sample: "Heading two" },
  { cls: "t-h3", sample: "Heading three" },
  { cls: "t-body", sample: "Body copy renders in Inter Tight at 14px with a soft warm-ink color." },
  { cls: "t-body-sm", sample: "Small body copy for dense interfaces." },
  { cls: "t-label", sample: "Tracked caps label" },
  { cls: "t-eyebrow-italic", sample: "Editorial eyebrow — italic serif" },
  { cls: "t-hint", sample: "Hint copy for captions" },
  { cls: "t-mono", sample: "1,234,567.89" },
  { cls: "t-mono-micro", sample: "0421 · 2026" },
  { cls: "t-num-display", sample: "+2.34%" },
];

export default function DesignPreviewPage() {
  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-5xl px-8 py-16">
        {/* Nameplate */}
        <header className="mb-16 border-b border-border-hair pb-10">
          <div className="flex items-baseline gap-4">
            <span className="text-brand" style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "72px", lineHeight: 1 }}>
              α
            </span>
            <span className="t-display-xl" style={{ fontSize: "clamp(44px, 6vw, 80px)" }}>
              AlphaDesk
            </span>
          </div>
          <p className="t-eyebrow-italic mt-4">§ F0 · tokens &amp; typography foundation</p>
          <p className="t-body mt-2">
            Every swatch, class, and number on this page is wired to
            <span className="t-mono"> src/styles/design-tokens.css</span> — the single source of truth.
          </p>
        </header>

        {/* Swatches */}
        <section className="mb-16">
          <h2 className="t-h2 mb-2">Color tokens</h2>
          <p className="t-label mb-6 text-fg-muted">Tailwind utility · CSS variable</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {SWATCHES.map((s) => (
              <div
                key={s.name}
                className={`${s.bg} ${s.text} rounded-md border border-border-hair p-4`}
                style={{ minHeight: "88px" }}
              >
                <div className="t-mono text-[11px]">{s.name}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Type specimen */}
        <section className="mb-16">
          <h2 className="t-h2 mb-6">Type specimen</h2>

          <div className="mb-8 space-y-3">
            <p className="t-display-xl">Alpha, delivered in italic.</p>
            <p className="t-display-lg">A louder serif, still restrained.</p>
            <p className="t-display-md">Page-level title.</p>
          </div>

          <div className="mb-8 grid gap-4">
            <p className="t-h1">Inter Tight — heading one</p>
            <p className="t-h2">Inter Tight — heading two</p>
            <p className="t-h3">Inter Tight — heading three</p>
            <p className="t-body">
              Body copy runs in Inter Tight at 14px with warm-ink dim color. It carries the interface —
              descriptions, paragraphs, helper text.
            </p>
            <p className="t-label">Tracked caps label · metadata</p>
          </div>

          <div className="mb-8 rounded-md border border-border bg-bg-card p-6">
            <p className="t-label mb-3">Mono tabular — numbers always</p>
            <div className="space-y-2">
              <div className="t-mono text-2xl">
                $1,234,567.89 <span className="text-profit">+2.34%</span>
              </div>
              <div className="t-mono text-lg">
                $ 98,742.10 <span className="text-loss">-0.42%</span>
              </div>
              <div className="t-mono-micro">
                0421 · 2026-04-17 · 14:32:07 UTC
              </div>
            </div>
          </div>
        </section>

        {/* Semantic classes table */}
        <section className="mb-16">
          <h2 className="t-h2 mb-6">Semantic .t-* classes</h2>
          <div className="divide-y divide-border-hair rounded-md border border-border bg-bg-elev-1">
            {SEMANTIC_CLASSES.map(({ cls, sample }) => (
              <div key={cls} className="flex items-center gap-6 px-5 py-4">
                <code className="t-mono w-44 shrink-0 text-xs text-fg-muted">.{cls}</code>
                <span className={cls}>{sample}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Utility colors */}
        <section className="mb-16">
          <h2 className="t-h2 mb-6">Utility colors</h2>
          <div className="space-y-2">
            <p className="u-profit t-mono text-xl">profit — $4,812.00 +1.82%</p>
            <p className="u-loss t-mono text-xl">loss — $1,204.50 -0.94%</p>
            <p className="u-brand t-mono text-xl">brand — gold accent</p>
            <p className="u-dim t-body">dim — secondary body text</p>
            <p className="u-muted t-body">muted — tertiary body text</p>
          </div>
        </section>

        {/* Rules & dividers */}
        <section className="mb-16">
          <h2 className="t-h2 mb-6">Rules &amp; dividers</h2>
          <div className="space-y-6">
            <div>
              <p className="t-label mb-2">u-divider</p>
              <hr className="u-divider" />
            </div>
            <div>
              <p className="t-label mb-2">u-divider-hair</p>
              <hr className="u-divider-hair" />
            </div>
            <div>
              <p className="t-label mb-2">u-rule (editorial § tag stop)</p>
              <div className="u-rule" />
            </div>
          </div>
        </section>

        <footer className="border-t border-border-hair pt-6">
          <p className="t-mono-micro">
            alphadesk · design-foundation · F0 · tradingalpha.net
          </p>
        </footer>
      </div>
    </main>
  );
}
