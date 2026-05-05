import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const configDir = dirname(fileURLToPath(import.meta.url));

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
    ];
  },
};

export default nextConfig;
