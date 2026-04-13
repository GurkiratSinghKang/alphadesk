import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  devIndicators: false,
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns"],
  },
  async redirects() {
    return [
      { source: "/dashboard", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
