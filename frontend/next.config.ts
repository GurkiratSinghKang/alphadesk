import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const configDir = dirname(fileURLToPath(import.meta.url));
const isDevelopment = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval' blob:" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  [
    "connect-src 'self'",
    isDevelopment ? "http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*" : "",
    "wss:",
  ].filter(Boolean).join(" "),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  devIndicators: false,
  turbopack: {
    root: configDir,
  },
  experimental: {
    // Audit F-F5 (2026-05-05): phosphor was missing from this list, so
    // every page importing a single phosphor icon shipped the full
    // ~1.6MB barrel. ``optimizePackageImports`` rewrites
    // ``import { Foo } from "@phosphor-icons/react"`` into a deep
    // import targeting only the requested icon, dropping the bundle by
    // a measurable amount on cold first-paint.
    optimizePackageImports: ["lucide-react", "@phosphor-icons/react"],
  },
  async redirects() {
    return [
      { source: "/dashboard", destination: "/", permanent: true },
      // v2 redesign: the public Risk Disclosure page moved from /risk
      // to /legal/risk to free /risk-dashboard for the new authenticated
      // trading risk surface. Permanent (308) redirect preserves SEO
      // for the ~7 internal + external links that referenced /risk.
      { source: "/risk", destination: "/legal/risk", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
