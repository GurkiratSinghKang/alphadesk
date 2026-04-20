import type { Metadata, Viewport } from "next";
import { Inter_Tight, Newsreader, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/lib/providers";
import "./globals.css";

// iOS/mobile viewport — `viewportFit: "cover"` allows the app to paint under
// the notch / home-indicator bars; we then pad via env(safe-area-inset-*)
// in globals.css so text and chrome stay clear of those zones.
// TODO(design): produce /icon-192.png and /icon-512.png PNGs for the PWA
//   manifest (frontend/public/manifest.webmanifest). Shipped without icons.
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

const newsreader = Newsreader({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["italic", "normal"],
  axes: ["opsz"],
  display: "swap",
  fallback: ["Iowan Old Style", "Times New Roman", "Georgia", "serif"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
  fallback: ["SF Mono", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: "AlphaDesk — AI-Powered Trading Terminal",
  description:
    "Claude-powered trading platform with multi-strategy pipeline, real-time analysis, and automated portfolio management.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "AlphaDesk",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "AlphaDesk — AI-Powered Trading Terminal",
    description:
      "Claude-powered trading platform with multi-strategy pipeline, real-time analysis, and automated portfolio management.",
    url: "https://tradingalpha.net",
    siteName: "AlphaDesk",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AlphaDesk — AI-Powered Trading Terminal",
    description: "Claude-powered trading platform.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${interTight.variable} ${newsreader.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full bg-bg text-fg" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
