/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the standalone dependency preparer. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepare } = require('../scripts/patch-lint-minimatch.cjs');
const sha = (text) => createHash('sha256').update(text).digest('hex');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'body-synth-lint-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const folder = path.join(directory, 'node_modules', 'fixture');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'package.json'), '{"version":"1.2.3"}');
  const before = 'const match = require("minimatch");';
  const after = 'const { minimatch: match } = require("minimatch");';
  const patches = { packages: { fixture: '1.2.3' }, files: ['one.js', 'two.js'].map((name) => ({
    path: `fixture/${name}`, beforeSha256: sha(before), afterSha256: sha(after),
    replacements: [{ from: before, to: after, count: 1 }],
  })) };
  for (const name of ['one.js', 'two.js']) fs.writeFileSync(path.join(folder, name), before);
  return { directory, folder, patches, before, after };
}

test('preparation gate detects ignore-scripts install and is repeatable after preparation', (t) => {
  const f = fixture(t);
  assert.throws(() => prepare({ ...f, checkOnly: true }), /npm run prepare:lint/);
  assert.equal(prepare(f), 2);
  assert.equal(prepare(f), 0);
  assert.equal(prepare({ ...f, checkOnly: true }), 0);
  assert.equal(fs.readFileSync(path.join(f.folder, 'one.js'), 'utf8'), f.after);
});

test('unknown version or file content fails before any consumer is modified', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.folder, 'two.js'), 'changed upstream contents');
  assert.throws(() => prepare(f), /Unexpected dependency contents/);
  assert.equal(fs.readFileSync(path.join(f.folder, 'one.js'), 'utf8'), f.before);
  fs.writeFileSync(path.join(f.folder, 'two.js'), f.before);
  fs.writeFileSync(path.join(f.folder, 'package.json'), '{"version":"1.2.4"}');
  assert.throws(() => prepare(f), /Review lint patches/);
  assert.equal(fs.readFileSync(path.join(f.folder, 'one.js'), 'utf8'), f.before);
});

test('an incomplete toolchain fails and an entirely omitted development toolchain skips', (t) => {
  const f = fixture(t);
  f.patches.packages.missing = '1.0.0';
  assert.throws(() => prepare(f), /Incomplete lint toolchain/);
  fs.rmSync(path.join(f.directory, 'node_modules'), { recursive: true });
  assert.equal(prepare(f), 0);
});

test('a stale resolved minimatch version fails before any consumer is modified', (t) => {
  const f = fixture(t);
  f.patches.minimatchVersion = '11.0.3';
  const dep = path.join(f.folder, 'node_modules', 'minimatch');
  fs.mkdirSync(dep, { recursive: true });
  fs.writeFileSync(path.join(dep, 'package.json'), '{"version":"3.1.5"}');
  assert.throws(() => prepare(f), /Unexpected minimatch dependency/);
  assert.equal(fs.readFileSync(path.join(f.folder, 'one.js'), 'utf8'), f.before);
});
