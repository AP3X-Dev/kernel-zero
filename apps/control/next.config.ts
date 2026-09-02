import type { NextConfig } from "next";

// React's development runtime compiles components with eval; the built app never does, so the allowance stops at `next dev`.
export function contentSecurityPolicy(environment: string | undefined = process.env.NODE_ENV): string {
  const scriptSrc = environment === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";
  return `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; ${scriptSrc}; connect-src 'self' https:; font-src 'self' data:`;
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
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
