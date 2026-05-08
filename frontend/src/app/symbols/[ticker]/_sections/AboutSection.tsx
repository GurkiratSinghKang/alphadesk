"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getTickerFundamentals } from "@/lib/api";
import type { TickerFundamentals } from "@/types";

const DASH = "—";

// 24h matches the backend Redis TTL — fundamentals don't move within a
// trading day. Use the *exact* same query key as KeyStats so React Query
// coalesces both consumers into a single network call.
const STALE_TIME_MS = 24 * 60 * 60 * 1000;
const PUBLIC_SYMBOL_DATA_OPTIONS = {
  suppressAuthRedirect: true,
  suppressGlobalError: true,
} as const;

// Anything longer than this gets the line-clamp + "Show more" treatment.
// Threshold is approximate — line-clamp-6 will start to truncate well
// before this length on narrow viewports anyway.
const LONG_DESCRIPTION_THRESHOLD = 200;

export interface AboutSectionProps {
  symbol: string;
}

interface ShellProps {
  variant: "loading" | "ready" | "error";
  sector: string | null;
  industry: string | null;
  description: string | null;
}

function formatSectorIndustry(sector: string | null, industry: string | null): string {
  // Em-dash if either side is missing — pure DASH is the canonical "no
  // value" glyph everywhere else on this page.
  if (!sector && !industry) return DASH;
  const left = sector ?? DASH;
  const right = industry ?? DASH;
  return `${left} · ${right}`;
}

function Shell({ variant, sector, industry, description }: ShellProps) {
  const [expanded, setExpanded] = useState(false);

  const isLong =
    variant === "ready" &&
    typeof description === "string" &&
    description.length > LONG_DESCRIPTION_THRESHOLD;

  const showFallback = variant === "ready" && (description == null || description.trim() === "");

  // Loading + error states show a fixed body string regardless of the
  // (always-null) description prop.
  let body: string;
  if (variant === "loading") {
    body = "Loading…";
  } else if (variant === "error") {
    body = "Description unavailable";
  } else if (showFallback) {
    body = "Company description not available.";
  } else {
    body = description as string;
  }

  const sectorIndustryText =
    variant === "error" ? DASH : formatSectorIndustry(sector, industry);

  // Apply line-clamp only when collapsed AND we have a real description
  // long enough to need it.
  const descriptionClass =
    variant === "ready" && !showFallback && isLong && !expanded
      ? "mt-3 t-mono text-body-sm line-clamp-6"
      : "mt-3 t-mono text-body-sm";

  // Show fallback / loading / error copy in muted style, real
  // descriptions in normal foreground.
  const muted =
    variant !== "ready" || showFallback ? " u-muted" : "";

  return (
    <section
      id="about"
      aria-labelledby="about-heading"
      data-testid="about-section"
      data-slot={`about-section-${variant}`}
      className="rounded-md border border-border-hair bg-bg-elev-1 p-4 scroll-mt-24 mx-4 sm:mx-6 mb-6"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 id="about-heading" className="t-label u-muted">ABOUT</h2>
        <span className="t-mono text-label u-muted" data-slot="about-sector-industry">
          {sectorIndustryText}
        </span>
      </header>
      <p
        id="about-description-body"
        className={`${descriptionClass}${muted}`}
        data-slot="about-description"
      >
        {body}
      </p>
      {isLong && !showFallback ? (
        <button
          type="button"
          data-slot="about-toggle"
          aria-expanded={expanded}
          aria-controls="about-description-body"
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-2 t-mono text-label u-muted hover:text-fg rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </section>
  );
}

export function AboutSection({ symbol }: AboutSectionProps) {
  const query = useQuery<TickerFundamentals>({
    queryKey: ["fundamentals", symbol],
    queryFn: () => getTickerFundamentals(symbol, PUBLIC_SYMBOL_DATA_OPTIONS),
    staleTime: STALE_TIME_MS,
    enabled: Boolean(symbol),
  });

  if (query.isLoading) {
    return <Shell variant="loading" sector={null} industry={null} description={null} />;
  }

  if (query.isError || !query.data) {
    return <Shell variant="error" sector={null} industry={null} description={null} />;
  }

  return (
    <Shell
      variant="ready"
      sector={query.data.sector}
      industry={query.data.industry}
      description={query.data.description}
    />
  );
}

export default AboutSection;
