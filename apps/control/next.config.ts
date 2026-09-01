import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https:; font-src 'self' data:" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;

const config: NextConfig = {
  headers() {
    return Promise.resolve([{ headers: [...securityHeaders], source: "/:path*" }]);
  },
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@kernel-zero/contracts",
    "@kernel-zero/domain",
    "@kernel-zero/persistence",
  ],
};

export default config;
