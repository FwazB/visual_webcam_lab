import type { NextConfig } from "next";

// Security headers. The app is fully client-side: no API routes, no server
// actions, no secrets. It loads MediaPipe WASM from cdn.jsdelivr.net and
// models from storage.googleapis.com, runs an AudioWorklet from /worklets,
// and uses camera + microphone on the same origin.
//
// The Content-Security-Policy is shipped report-only first so a wrong host
// cannot break camera or WASM in production; once the browser console shows
// no violations, rename the header to "Content-Security-Policy".
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com ws://127.0.0.1:9980",
  "worker-src 'self' blob:",
  "media-src 'self' blob: mediastream:",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy-Report-Only", value: csp },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Never serve a stale AudioWorklet after a redeploy.
      { source: "/worklets/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }] },
    ];
  },
};

export default nextConfig;
