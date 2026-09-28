import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  devIndicators: false,
  outputFileTracingIncludes: { "/api/agent-kit/*": ["./agent-kit/mcp/*"] },
};

export default nextConfig;
