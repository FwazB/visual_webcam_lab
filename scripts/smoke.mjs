import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:3000");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const pageTitles = {
  "/fuzz": "Fuzz | body.synth",
  "/progressions": "Chord progression generator | body.synth",
  "/pocket-operators": "Pocket Operator guide | body.synth",
};
const publicScripts = [
  "/worklets/pitch-processor.js", "/worklets/recorder-processor.js",
  "/vision/fretboard-worker.js", "/vision/neck-tracker.js",
  "/vision/neck-detector.js", "/vision/opencv-4.12.0.js",
];
const localScripts = new Map(await Promise.all(publicScripts.map(async (path) => [
  path, await readFile(new URL(`../public${path}`, import.meta.url)),
])));

const progressionPages = ["/progressions", "/progressions?instrument=bass", "/progressions?instrument=bass&song=creep", "/progressions?mode=free"];
for (const path of ["/", "/guitar", "/bass", ...progressionPages, "/studio", "/pocket-operators", "/for-you", "/for-you/privacy", "/ascii", "/fuzz", ...publicScripts]) {
  const url = new URL(path, base);
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
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
    assert.match(csp, /connect-src[^;]*http:\/\/127\.0\.0\.1:9982\/motion(?: |;)/);
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
    assert.ok(body.includes(`<title>${pageTitles[url.pathname] ?? "body.synth"}</title>`), `${path} must have its page title`);
    assert.equal(body.includes('aria-label="AirPods head motion"'), path !== "/for-you/privacy",
      `${path} must have the appropriate site-wide motion controls`);
    assert.equal(/<button\b[^>]*><span\b[^>]*><\/span>Start AirPods<\/button>/.test(body), path !== "/for-you/privacy",
      `${path} must show the one-click AirPods launcher on creative pages`);
    if (path === "/") {
      // The homepage is server-rendered: every project link is in the HTML.
      for (const href of ["/guitar", "/bass", "/progressions", "/studio", "/for-you", "/ascii", "/pocket-operators", "/fuzz"]) assert.ok(body.includes(`href="${href}"`), `/ must link to ${href}`);
    }
    if (url.pathname === "/progressions") {
      const instrument = url.searchParams.get("instrument") === "bass" ? "Bass" : "Guitar";
      assert.match(body, /<h1\b[^>]*>Chord progression generator<\/h1>/i);
      assert.match(body, new RegExp(`<button\\b[^>]*aria-pressed="true"[^>]*>${instrument}</button>`));
      if (url.searchParams.get("mode") === "free") {
        assert.ok(body.includes('aria-label="Progression bars"'));
        assert.match(body, /<h2\b[^>]*>Your progression<\/h2>/);
      } else {
        assert.ok(body.includes('aria-label="Practice chords"'));
        const advanced = url.searchParams.get("song") === "creep";
        assert.match(body, advanced ? /<h2\b[^>]*>Creep<\/h2>/ : /<h2\b[^>]*>Three Little Birds<\/h2>/);
        assert.ok(body.includes(advanced ? 'aria-label="Chord 4, Cm, iv, 8 beats"' : 'aria-label="Chord 2, D, IV, 4 beats"'));
        if (instrument === "Bass") assert.ok(body.includes(advanced ? "Hear triad" : "Hear root"));
      }
    }
    if (path === "/fuzz") {
      assert.match(body, /<button\b[^>]*>Start camera<\/button>/);
      assert.match(body, /<h2\b[^>]*>AirPods head tilt<\/h2>/);
      const macOption = body.match(/<option\b[^>]*>This Mac<\/option>/)?.[0] ?? "";
      assert.match(macOption, /value="mac"/);
      assert.match(macOption, /\bselected\b/, "direct Mac tracking must be selected on first load");
      assert.ok(body.includes("sh touchdesigner/fuzz/headphones/build.sh"));
      assert.match(body, /<option\b[^>]*value="iphone"[^>]*>iPhone<\/option>/);
      assert.match(body, /<label\b[^>]*>Fuzz pairing code<\/label>/);
      assert.match(body, /<button\b[^>]*>Pair with Fuzz<\/button>/);
      assert.ok(body.includes('href="https://github.com/FwazB/visual_webcam_lab/tree/main/touchdesigner/fuzz"'));
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
