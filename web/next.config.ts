import path from "path";
import type { NextConfig } from "next";

/**
 * Must be the repo root that contains both `web/` and `sdk/` (this project).
 * Using `../..` breaks standalone clones (e.g. GitHub / Vercel) and can cause
 * missing webpack chunks like `./611.js` at runtime.
 */
const nextConfig: NextConfig = {
  transpilePackages: ["semantic-search-sdk"],
  outputFileTracingRoot: path.join(__dirname, "..")
};

export default nextConfig;
