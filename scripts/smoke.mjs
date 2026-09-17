import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:3000");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const localWorklet = await readFile(new URL("../public/worklets/pitch-processor.js", import.meta.url));

for (const path of ["/guitar", "/bass", "/worklets/pitch-processor.js"]) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `${path} must load`);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(self\), microphone=\(self\)/);
  assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=63072000/);
  const csp = response.headers.get("content-security-policy-report-only") ?? "";
  assert.match(csp, /connect-src[^;]*ws:\/\/127\.0\.0\.1:9980/);
  assert.match(csp, /object-src 'none'/);
  const body = await response.text();
  if (path.includes("worklets")) {
    assert.match(response.headers.get("content-type") ?? "", /javascript/);
    assert.match(response.headers.get("cache-control") ?? "", /max-age=0/);
    assert.equal(sha256(body), sha256(localWorklet), "deployed processor must match this checkout");
  } else {
    // The trainer uses next/dynamic with SSR disabled. HTTP checks can verify
    // its shell/assets; rendered controls are checked in the browser.
    assert.match(body, /<title>body\.synth<\/title>/);
    const scripts = [...body.matchAll(/<script[^>]+src="([^"]+)"/g)];
    assert.ok(scripts.length > 0, `${path} must reference application scripts`);
    const asset = await fetch(new URL(scripts.at(-1)[1], base), { signal: AbortSignal.timeout(15000) });
    assert.equal(asset.status, 200, `${path} application script must load`);
  }
  console.log(`PASS ${base.origin}${path}: content and security headers`);
}
