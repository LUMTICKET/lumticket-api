import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root: htdocs contains other, unrelated projects with
  // their own lockfiles, which otherwise confuses Next.js's root inference.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
