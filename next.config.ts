import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Auth (cookies()) on every page — request-time rendering, not cache components.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
