import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @aligned/core is shipped as raw TypeScript (the monorepo "just-in-time" package
  // pattern), so Next must transpile it instead of expecting pre-built JS.
  transpilePackages: ["@aligned/core"],
};

export default nextConfig;
