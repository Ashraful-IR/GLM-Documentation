import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Accessing the dev server from other devices on the LAN (e.g. the network
  // URL Next prints at startup) is blocked by default for safety. Allow it so
  // chunks and HMR load when opening http://192.168.0.47:3000.
  allowedDevOrigins: ["192.168.0.47"],
  experimental: {
    // proxy.ts buffers every request body (a Next.js behavior when a proxy is
    // present); the default 10MB cap silently truncates larger bodies, which
    // breaks saves of very large documents. Raise it well above the Zod-level
    // document payload cap (16MB) so validation, not buffering, fails first.
    proxyClientMaxBodySize: "50mb",
  },
  output: "standalone",
};

export default nextConfig;
