import Link from "next/link";

import Display from "@/components/typography/Display";

export default function MissingReportsNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[760px] flex-col justify-center gap-8 bg-bg px-6 py-16 text-fg">
      <div className="flex flex-col gap-5">
        <span
          className="font-mono text-body-sm uppercase text-fg-hint"
          style={{ letterSpacing: 0 }}
        >
          404
        </span>
        <Display size="lg" as="h1" className="max-w-[14ch]">
          Not on the tape.
        </Display>
        <p className="max-w-[560px] font-display italic text-numeric-md leading-snug text-fg-muted">
          This dashboard route is not in the desk&rsquo;s registry. It may have
          moved, been retired, or never existed in the first place.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2 rounded-sm bg-primary px-4 py-2 font-sans text-body-sm font-semibold text-ink-1000 transition-colors hover:bg-gold-300"
          style={{ letterSpacing: 0 }}
        >
          Back to dashboard
        </Link>
        <Link
          href="/reports"
          className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-border bg-bg-elev-1 px-4 py-2 font-sans text-body-sm font-semibold text-fg transition-colors hover:bg-bg-elev-2"
        >
          Open reports
        </Link>
      </div>
    </main>
  );
}
