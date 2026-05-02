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
    optimizePackageImports: ["lucide-react"],
  },
  async redirects() {
    return [
      { source: "/dashboard", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
