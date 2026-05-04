import path from "path";
import type { NextConfig } from "next";

/**
 * When this app lives inside a larger repo (e.g. `muttonkodibiriyani/`) that has
 * its own `package-lock.json`, Next 15 may infer that parent as the workspace
 * root. That breaks the server bundle: `webpack-runtime.js` does
 * `require("./331.js")` while chunks are emitted under `.next/server/chunks/`.
 *
 * Pin tracing to this app directory (`semantic-search/web`) so the inferred
 * root matches `distDir` and chunk paths resolve. Do not use `..` here; that
 * regressed into MODULE_NOT_FOUND for `./331.js` / `./611.js`.
 */
const nextConfig: NextConfig = {
  transpilePackages: ["semantic-search-sdk"],
  outputFileTracingRoot: path.resolve(__dirname)
};

export default nextConfig;
