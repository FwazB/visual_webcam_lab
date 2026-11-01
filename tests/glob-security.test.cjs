/* eslint-disable @typescript-eslint/no-require-imports -- Exercises the installed lint glob dependency. */
const test = require("node:test");
const assert = require("node:assert/strict");
const micromatch = require("micromatch");
const lock = require("../package-lock.json");

test("lockfile has no dangling local package links", () => {
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (entry.link) {
      assert.ok(lock.packages[entry.resolved]?.version, `${path} links to a missing package`);
    }
  }
});

test("installed glob matching keeps normal patterns and rejects excessive brace nesting safely", () => {
  assert.deepEqual(micromatch(["src/a.ts", "src/b.ts", "src/z.js"], "src/{a,b}.ts"), ["src/a.ts", "src/b.ts"]);
  const nested = "{".repeat(4000) + "a,b" + "}".repeat(4000);
  assert.throws(() => micromatch.braces(nested), { name: "SyntaxError", message: /safe AST limits/ });
});
