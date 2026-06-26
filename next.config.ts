import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb"
    }
  }
};

export default nextConfig;
