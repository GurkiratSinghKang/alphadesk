"use client";

import { useEffect } from "react";

/**
 * /app/global-error.tsx — root-layout error boundary.
 * ───────────────────────────────────────────────────
 * Next.js renders this when the error originates inside the root layout
 * itself (where `<html>` / `<body>` / `<Providers>` would normally be).
 * That means we CANNOT reach into the root layout here — we must supply
 * our own `<html>` and `<body>` and fall back to system fonts since
 * next/font hasn't been able to inject its CSS vars.
 *
 * We intentionally render plain HTML with inline styles sourced from the
 * AlphaDesk token values so the surface still looks like the rest of the
 * product even when the style pipeline is in a degraded state.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AlphaDesk global error]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  const message =
    (error.message && error.message.trim().length > 0
      ? error.message
      : "An unexpected error occurred. The desk couldn't recover.") ??
    "An unexpected error occurred. The desk couldn't recover.";

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          // iOS: 100dvh (dynamic viewport height) accounts for the URL bar
          // collapsing on scroll; 100vh undercuts the visible area.
          minHeight: "100dvh",
          backgroundColor: "#0b0a09",
          color: "#ece6d2",
          fontFamily:
            '"Inter Tight", "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
          letterSpacing: "-0.005em",
          lineHeight: 1.5,
        }}
      >
        <main
          style={{
            display: "flex",
            minHeight: "100dvh",
            alignItems: "center",
            justifyContent: "center",
            padding: "48px 24px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 24,
              maxWidth: 560,
              width: "100%",
            }}
          >
            <span
              className="text-eyebrow"
              style={{
                color: "#7d7665",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.16em",
                lineHeight: 1,
              }}
            >
              &sect; &middot; Global error
            </span>
            <h1
              style={{
                margin: 0,
                fontFamily: 'Newsreader, "Iowan Old Style", Georgia, serif',
                fontStyle: "italic",
                fontWeight: 400,
                fontSize: "clamp(32px, 4vw, 52px)",
                lineHeight: 1.18,
                letterSpacing: "-0.025em",
                color: "#ece6d2",
                maxWidth: "18ch",
              }}
            >
              The desk failed to mount
            </h1>
            <p
              style={{
                margin: 0,
                fontStyle: "italic",
                fontSize: 15,
                color: "#7d7665",
                lineHeight: 1.3,
              }}
            >
              {message}
            </p>
            {error.digest ? (
              <p
                className="text-eyebrow"
                style={{
                  margin: 0,
                  fontFamily:
                    '"JetBrains Mono", "SF Mono", Menlo, monospace',
                  color: "#5b5547",
                  textTransform: "uppercase",
                  letterSpacing: "0.02em",
                }}
              >
                Ref: {error.digest}
              </p>
            ) : null}

            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                paddingTop: 4,
              }}
            >
              <button
                type="button"
                onClick={reset}
                style={{
                  background: "#c9a66b",
                  color: "#1a1206",
                  border: "1px solid transparent",
                  padding: "10px 16px",
                  borderRadius: 4,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  letterSpacing: "0.01em",
                }}
              >
                Try again
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- root-layout error boundary renders plain HTML before next/link is available */}
              <a
                href="/"
                style={{
                  background: "transparent",
                  color: "#ece6d2",
                  border: "1px solid #3a3628",
                  padding: "10px 16px",
                  borderRadius: 4,
                  fontSize: 12.5,
                  fontWeight: 500,
                  textDecoration: "none",
                }}
              >
                Back to dashboard
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
