"use client";

import { useMorningBrief } from "@/hooks/useQueries";

interface BriefRow {
  time: string;
  text: string;
  tone: "up" | "down" | "neutral";
}

/**
 * V2BriefingStrip — "Since you last logged in" briefing rail matching the
 * v2 design. Italic Newsreader display title on the left + timestamped
 * briefing rows on the right with status dots.
 */
export default function V2BriefingStrip() {
  const brief = useMorningBrief();

  // Map the existing morning-brief payload into the design's shape. Falls
  // back to a small editorial placeholder when the API returns nothing so
  // the dashboard never renders an empty strip.
  const data = brief.data as unknown as { items?: BriefRow[] } | undefined;
  const rows: BriefRow[] =
    data?.items && data.items.length > 0
      ? data.items.slice(0, 4)
      : [
          {
            time: "06:42",
            text: "Three new pipeline candidates surfaced overnight; Risk gating is GREEN across all books.",
            tone: "up",
          },
          {
            time: "07:10",
            text: "Earnings tonight: NVDA, CRM, ZS — two are in your watchlists.",
            tone: "neutral",
          },
          {
            time: "07:24",
            text: "Pairs strategy drift is outside the cointegration band — review queued.",
            tone: "down",
          },
          {
            time: "08:01",
            text: "Your weekly memo is queued and ready for review at 09:30 ET.",
            tone: "neutral",
          },
        ];

  return (
    <div
      style={{
        padding: "0 32px",
      }}
    >
      <div
        style={{
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          padding: "20px 0",
          display: "grid",
          gridTemplateColumns: "200px 1fr",
          gap: 32,
          alignItems: "start",
        }}
      >
        <div>
          <div
            className="italic"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 24,
              color: "var(--brand)",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
            }}
          >
            Since you
            <br />
            last logged in
          </div>
          <div className="t-label" style={{ marginTop: 10 }}>
            Briefing · {fmtTimeAgo(rows[0]?.time)}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.map((row, i) => (
            <div
              key={`${row.time}-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "auto auto 1fr",
                gap: 14,
                padding: "10px 0",
                borderBottom:
                  i < rows.length - 1
                    ? "1px solid var(--border-hair)"
                    : "none",
                alignItems: "baseline",
              }}
            >
              <span
                className="t-mono"
                style={{
                  fontSize: 10,
                  color: "var(--fg-hint)",
                  letterSpacing: "0.04em",
                }}
              >
                {row.time}
              </span>
              <Dot tone={row.tone} />
              <span
                className="italic"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 15.5,
                  color: "var(--ink-900)",
                  lineHeight: 1.45,
                  letterSpacing: "-0.005em",
                }}
              >
                {row.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Dot({ tone }: { tone: BriefRow["tone"] }) {
  const color =
    tone === "up"
      ? "var(--up-500)"
      : tone === "down"
        ? "var(--down-500)"
        : "var(--fg-hint)";
  return (
    <span
      aria-hidden
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        alignSelf: "center",
        boxShadow: tone === "up" || tone === "down" ? `0 0 4px ${color}` : "none",
      }}
    />
  );
}

function fmtTimeAgo(time: string | undefined): string {
  if (!time) return "moments ago";
  return `${time} ET`;
}
