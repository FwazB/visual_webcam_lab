/* eslint-disable @typescript-eslint/no-require-imports -- Dependency preparation runs before ESLint is available. */
// Patch consumers, never the registry dependency or its advertised version.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const manifest = require('../security/lint-minimatch/patches.json');
const root = path.resolve(__dirname, '..');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function prepare({ checkOnly = false, directory = root, patches = manifest } = {}) {
  const changes = [];
  const installed = Object.keys(patches.packages).filter((name) => existsSync(path.join(directory, 'node_modules', name, 'package.json')));
  // Production-only installs have no lint toolchain to patch.
  if (!installed.length) return 0;
  assert.equal(installed.length, Object.keys(patches.packages).length, 'Incomplete lint toolchain; run npm ci');
  for (const [name, version] of Object.entries(patches.packages)) {
    const packageFile = path.join(directory, 'node_modules', name, 'package.json');
    const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
    assert.equal(pkg.version, version, `Review lint patches for changed ${name} version`);
    if (patches.minimatchVersion) {
      const fromConsumer = createRequire(packageFile);
      assert.equal(fromConsumer('minimatch/package.json').version, patches.minimatchVersion, `Unexpected minimatch dependency for ${name}; run npm ci`);
    }
  }
  for (const patch of patches.files) {
    const file = path.join(directory, 'node_modules', patch.path);
    const source = readFileSync(file, 'utf8');
    const hash = sha256(source);
    if (hash === patch.afterSha256) continue;
    assert.equal(hash, patch.beforeSha256, `Unexpected dependency contents: ${patch.path}; review patches before updating`);
    assert.ok(!checkOnly, 'Lint dependencies need preparation: run npm run prepare:lint');
    let updated = source;
    for (const replacement of patch.replacements) {
      assert.equal(updated.split(replacement.from).length - 1, replacement.count, `Unexpected patch count in ${patch.path}`);
      updated = updated.split(replacement.from).join(replacement.to);
    }
    assert.equal(sha256(updated), patch.afterSha256, `Invalid patch result: ${patch.path}`);
    changes.push({ file, updated });
  }
  // Validate the complete set first so a version/content mismatch never applies a partial migration.
  for (const { file, updated } of changes) writeFileSync(file, updated);
  return changes.length;
}

module.exports = { prepare };
if (require.main === module) console.log(`Lint minimatch preparation: ${prepare()} consumer files updated.`);
