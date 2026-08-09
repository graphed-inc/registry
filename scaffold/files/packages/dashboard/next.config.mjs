import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // @app/core ships TypeScript source (no build step) — Next compiles it.
  transpilePackages: ["@app/core"],
  // Next 14 shares `distDir` between dev and build, so `next build` while the
  // dev server is running corrupts its assets (unstyled pages, 500s on css
  // chunks) until .next is wiped. Keep dev output in its own directory.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  // Standalone output keeps the production image small. Tracing from the
  // repo root puts server.js at
  // packages/dashboard/.next/standalone/packages/dashboard/server.js,
  // which is the command graphed.yaml runs. (Next 14: this key lives under
  // `experimental`; it moves to top-level in Next 15.)
  output: "standalone",
  experimental: {
    outputFileTracingRoot: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
