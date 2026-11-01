import type { NextConfig } from "next";

// Security headers. The app is fully client-side: no API routes, no server
// actions, no secrets. It loads MediaPipe WASM from cdn.jsdelivr.net and
// models from storage.googleapis.com, runs an AudioWorklet from /worklets,
// and uses camera + microphone on the same origin.
//
// Static Next pages need their inline hydration scripts. Blob scripts/workers
// support Tone's locally generated audio processors and clock. Production does
// not allow JavaScript eval in the page; the pinned OpenCV worker has its own
// restricted policy below because its bindings generate functions at startup.
const isDev = process.env.NODE_ENV === "development";
const mediaPipeRuntime = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm/";
const csp = [
  "default-src 'self'",
  `script-src 'self' blob: 'unsafe-inline' 'wasm-unsafe-eval' ${mediaPipeRuntime}${isDev ? " 'unsafe-eval'" : ""}`,
  "script-src-attr 'none'",
  `connect-src 'self' ${mediaPipeRuntime} https://storage.googleapis.com/mediapipe-models/ https://accounts.spotify.com https://api.spotify.com ws://127.0.0.1:9980${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "media-src 'self' blob: mediastream:",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Workers use the CSP on their own script response. This policy blocks fetch/
// WebSocket connections, nested workers and scripts from other origins. The
// worker has no DOM access and its embedded WASM requires no fetches.
const neckWorkerCsp = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-eval'",
  "connect-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Never serve a stale AudioWorklet after a redeploy.
      { source: "/worklets/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }] },
      { source: "/vision/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }] },
      // Next applies the last matching value for a header, so this replaces
      // the document policy only for the worker's entry script.
      { source: "/vision/fretboard-worker.js", headers: [{ key: "Content-Security-Policy", value: neckWorkerCsp }] },
    ];
  },
};

export default nextConfig;
