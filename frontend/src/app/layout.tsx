import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/lib/providers";
import WebVitalsReporter from "@/components/layout/WebVitalsReporter";
import ServiceWorkerRegistrar from "@/components/layout/ServiceWorkerRegistrar";
import "./globals.css";

// iOS/mobile viewport — `viewportFit: "cover"` allows the app to paint under
// the notch / home-indicator bars; we then pad via env(safe-area-inset-*)
// in globals.css so text and chrome stay clear of those zones.
// /icon-192.png and /icon-512.png (referenced by
// frontend/public/manifest.webmanifest) are programmatically-generated
// placeholders — an italic serif α glyph on our gold-frame + ink-panel
// palette. Replace with designer-produced artwork when the mark lands.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Self-hosted via next/font — no runtime fetch to fonts.googleapis.com.
// The dashboard/trading surfaces use Geist for both UI and display voice so
// software screens stay clean, sans-serif, and numerically crisp.
//
// chrome-batch-D P1-11 — previously this file invoked `Geist({ ... })`
// twice (once for `--font-ui`, once for `--font-display`), which made
// next/font emit two separate `@font-face` blocks pointing at the same
// woff2 payload. Each variable became its own preload tag, so the
// browser fetched Geist Regular (and every weight in the subset) twice
// on first paint. Collapse to a single `geist` invocation that exposes
// `--font-geist` and update design-tokens.css to point both `--font-ui`
// and `--font-display` slots at the single variable.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
  fallback: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
  fallback: ["SF Mono", "Menlo", "monospace"],
});

// Wave 3N persona-94/95 tagline-drift fix: three different descriptions
// (page title, og:description, twitter:description) collapsed to a single
// pair of canonical copy — `TAGLINE_SHORT` for titles, `TAGLINE_LONG` for
// descriptions. Change once, and every metadata field tracks it.
//
// R6-8 / R5-1 MAJOR: product name was split between
// "AI Trading Terminal" (login) and "AI-Powered Trading Terminal"
// (layout). Unify on sentence case "AI-powered trading terminal" so
// every surface (title, og:image alt, login eyebrow) reads the same.
const TAGLINE_SHORT = "AI-powered trading terminal";
const TAGLINE_LONG =
  "AI-powered trading platform with 12 systematic strategies, real-time analysis, and automated portfolio management.";
const PAGE_TITLE = `AlphaDesk · ${TAGLINE_SHORT}`;
// TODO(design): commission the real 1200×630 og card. For now we reference
// `/og-image.png` so the tag is correct even if the file is the favicon
// composited on a dark canvas placeholder. See `frontend/public/og-image.png`.
const OG_IMAGE = "/og-image.png";

// P115 fix: without `metadataBase`, Next.js resolves relative OG image URLs
// against `http://localhost:3000` in prod, poisoning social-unfurl previews.
// Pin to NEXT_PUBLIC_SITE_URL (falling back to the production hostname) so
// `/og-image.png` rewrites to `https://tradingalpha.net/og-image.png`.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://tradingalpha.net";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: PAGE_TITLE,
  description: TAGLINE_LONG,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "AlphaDesk",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: PAGE_TITLE,
    description: TAGLINE_LONG,
    url: "https://tradingalpha.net",
    siteName: "AlphaDesk",
    type: "website",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "AlphaDesk · AI-powered trading terminal",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: TAGLINE_LONG,
    images: [OG_IMAGE],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Dark is our SSR default — matches current visual behaviour and avoids
  // a flash on first paint. Once the client hydrates, <ThemeController>
  // reads `display.theme` from the preferences store and swaps the class
  // to "dark" / "light" / the OS preference accordingly.
  return (
    <html
      lang="en"
      className={`dark ${geist.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Round-24 / persona-A: preconnect to the API origin so the
            first /api/v1 fetch (vitals beacon, useDataPipeline) skips
            the TLS handshake on the LCP path. Same-origin in prod via
            Caddy reverse-proxy; the env var lets dev/staging hit a
            different host without breaking the rule. */}
        <link
          rel="preconnect"
          href={SITE_URL}
          crossOrigin="anonymous"
        />
      </head>
      <body className="h-full bg-bg text-fg" suppressHydrationWarning>
        {/* K-1 + K-14 (round-6): WebVitalsReporter mounts web-vitals@4
            listeners (LCP/CLS/INP/FCP/TTFB) and beacons each metric to
            `${NEXT_PUBLIC_API_URL}/api/v1/metrics/vitals` via sendBeacon,
            falling back to same-origin only when no API URL is configured.
            The backend endpoint is wired (api/routes/metrics.py) and
            rate-limited per IP (Round-17 / persona-C). */}
        <WebVitalsReporter />
        <ServiceWorkerRegistrar />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
