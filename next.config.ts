import type { NextConfig } from "next";
import { allHttpSecurityHeaders } from "./lib/http-security";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "prod-files-secure.s3.us-west-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "fesdmsjjlsuglinodcxq.supabase.co",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: allHttpSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
