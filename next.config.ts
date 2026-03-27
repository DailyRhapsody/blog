import type { NextConfig } from "next";
import { allHttpSecurityHeaders } from "./lib/http-security";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.public.blob.vercel-storage.com", pathname: "/**" },
      { protocol: "https", hostname: "**.blob.vercel-storage.com", pathname: "/**" },
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
