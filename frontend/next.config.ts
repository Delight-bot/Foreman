import type { NextConfig } from "next";

// The browser only talks to Next.js; /api is proxied to FastAPI (inside the plant network).
const api = process.env.FOREMAN_API_URL ?? "http://localhost:8000";

const config: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
  // Answers with the model and document ingest can take longer than the default proxy timeout.
  experimental: { proxyTimeout: 300_000 },
  // No Next.js badge in the corner: a technician's screen and a demo should show Foreman only.
  devIndicators: false,
};

export default config;
