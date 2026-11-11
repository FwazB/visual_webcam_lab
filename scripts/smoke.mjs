import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:3000");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const publicScripts = [
  "/worklets/pitch-processor.js", "/worklets/recorder-processor.js",
  "/vision/fretboard-worker.js", "/vision/neck-tracker.js",
  "/vision/neck-detector.js", "/vision/opencv-4.12.0.js",
];
const localScripts = new Map(await Promise.all(publicScripts.map(async (path) => [
  path, await readFile(new URL(`../public${path}`, import.meta.url)),
])));

for (const path of ["/", "/guitar", "/bass", "/studio", "/pocket-operators", "/for-you", "/for-you/privacy", "/ascii", ...publicScripts]) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `${path} must load`);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(self\), microphone=\(self\)/);
  assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=63072000/);
  assert.equal(response.headers.get("content-security-policy-report-only"), null, "policy must be enforced, not report-only");
  const csp = response.headers.get("content-security-policy") ?? "";
  if (path === "/vision/fretboard-worker.js") {
    assert.match(csp, /(?:^|; )script-src 'self' 'unsafe-eval'(?:;|$)/);
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /worker-src 'none'/);
    assert.doesNotMatch(csp, /https?:|blob:|'unsafe-inline'/);
  } else {
    assert.match(csp, /connect-src[^;]*ws:\/\/127\.0\.0\.1:9980/);
    assert.match(csp, /script-src[^;]*blob:[^;]*'wasm-unsafe-eval'/);
    assert.match(csp, /script-src-attr 'none'/);
    assert.match(csp, /frame-src 'none'/);
    assert.doesNotMatch(csp, /'unsafe-eval'|(?:^| )wss?:[ ;]/, "production page must not use development exceptions");
  }
  assert.match(csp, /object-src 'none'/);
  const body = await response.text();
  if (localScripts.has(path)) {
    assert.match(response.headers.get("content-type") ?? "", /javascript/);
    assert.match(response.headers.get("cache-control") ?? "", /max-age=0/);
    assert.match(response.headers.get("cache-control") ?? "", /must-revalidate/);
    assert.equal(sha256(body), sha256(localScripts.get(path)), "served script must match this checkout");
  } else {
    // Most pages use next/dynamic with SSR disabled. HTTP checks can verify
    // their shell/assets; this does not exercise rendered controls or devices.
    assert.match(body, path === "/pocket-operators" ? /<title>Pocket Operator guide \| body\.synth<\/title>/ : /<title>body\.synth<\/title>/);
    if (path === "/") {
      // The homepage is server-rendered: every project link is in the HTML.
      for (const href of ["/guitar", "/bass", "/studio", "/for-you", "/ascii", "/pocket-operators"]) assert.ok(body.includes(`href="${href}"`), `/ must link to ${href}`);
    }
    const scripts = [...body.matchAll(/<script[^>]+src="([^"]+)"/g)];
    assert.ok(scripts.length > 0, `${path} must reference application scripts`);
    const asset = await fetch(new URL(scripts.at(-1)[1], base), { signal: AbortSignal.timeout(15000) });
    assert.equal(asset.status, 200, `${path} application script must load`);
  }
  console.log(`PASS ${base.origin}${path}: content and security headers`);
}

for (const path of ["/.env", "/.env.local", "/.git/config", "/.mcp.json", "/package-lock.json", "/src/hooks/useNeckTracking.ts"]) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 404, `${path} must not expose project files`);
  console.log(`PASS ${base.origin}${path}: project file not served`);
}
