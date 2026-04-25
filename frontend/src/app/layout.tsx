import type { Metadata, Viewport } from "next";
import { Inter_Tight, Newsreader, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/lib/providers";
import WebVitalsReporter from "@/components/layout/WebVitalsReporter";
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

// Self-hosted via next/font — no runtime fetch to fonts.googleapis.com,
// avoids the CSP `style-src` / `font-src` restriction and eliminates the
// third-party @import in design-tokens.css. next/font injects CSS that
// assigns each variable on <html> (higher specificity than :root), so the
// tokens resolve to the self-hosted face and fall back cleanly otherwise.
const interTight = Inter_Tight({
  variable: "--font-ui",
  subsets: ["latin"],
  display: "swap",
  fallback: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
});

// K-13 (round-6): trimmed unused Newsreader weights / axes.
//   · `axes: ["opsz"]` was loading the optical-size variation, but no
//     selector in the codebase uses `font-variation-settings` or the
//     `font-optical-sizing` shorthand to actually flip between display
//     and text optical sizes. Loading the axis was paying for a font
//     subset feature we never reach.
//   · Both `italic` and `normal` styles are kept because both are used
//     (search confirmed: `font-display italic` is widespread; the
//     non-italic style backs serif headings via the design tokens).
const newsreader = Newsreader({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["italic", "normal"],
  display: "swap",
  fallback: ["Iowan Old Style", "Times New Roman", "Georgia", "serif"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
  fallback: ["SF Mono", "Menlo", "monospace"],
});

// Wave 3N persona-94/95 tagline-drift fix: three different descriptions
// (page title, og:description, twitter:description) collapsed to a single
// pair of canonical copy — `TAGLINE_SHORT` for titles, `TAGLINE_LONG` for
// descriptions. Change once, and every metadata field tracks it.
const TAGLINE_SHORT = "AI-Powered Trading Terminal";
const TAGLINE_LONG =
  "Claude-powered trading platform with 12 systematic strategies, real-time analysis, and automated portfolio management.";
const PAGE_TITLE = `AlphaDesk — ${TAGLINE_SHORT}`;
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
        alt: "AlphaDesk — AI-Powered Trading Terminal",
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
      className={`dark ${interTight.variable} ${newsreader.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full bg-bg text-fg" suppressHydrationWarning>
        {/* K-1 + K-14 (round-6): replaces the inline pre-hydration
            PerformanceObserver script. WebVitalsReporter mounts the
            web-vitals@4 listeners (LCP/CLS/INP/FCP/TTFB) and beacons
            each metric to /api/v1/metrics/vitals via sendBeacon. The
            backend endpoint is not yet wired — failures are swallowed
            so the page never breaks while we wait for FIX-3 to add the
            ingest route. See lib/web-vitals.ts for the TODO. */}
        <WebVitalsReporter />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
