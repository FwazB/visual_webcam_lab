/* eslint-disable @typescript-eslint/no-require-imports -- Node's built-in test runner. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const assets = path.join(__dirname, "../public/progressions");
const manifest = JSON.parse(fs.readFileSync(path.join(assets, "manifest.webmanifest"), "utf8"));

test("installed Progressions always opens its own canonical page", () => {
  assert.equal(manifest.id, "/progressions");
  assert.equal(manifest.start_url, manifest.id);
  assert.equal(manifest.scope, manifest.start_url);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.short_name, "Progressions");
});

test("home screen icon files match their declared sizes and have an opaque background", () => {
  assert.deepEqual(manifest.icons.filter(icon => icon.purpose === "any").map(icon => icon.sizes).sort(),
    ["192x192", "512x512"]);
  assert.ok(manifest.icons.some(icon => icon.purpose === "maskable" && icon.sizes === "512x512"));
  for (const icon of [...manifest.icons, { src: "/progressions/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]) {
    assert.equal(path.posix.dirname(icon.src), "/progressions");
    assert.equal(icon.type, "image/png");
    const png = fs.readFileSync(path.join(assets, path.basename(icon.src)));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.subarray(12, 16).toString(), "IHDR");
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
    assert.equal(png[25], 2, "RGB color without an alpha channel");
  }
});
