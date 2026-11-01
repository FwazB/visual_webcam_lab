/* eslint-disable @typescript-eslint/no-require-imports -- Verify the CommonJS APIs actually consumed by lint plugins. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

test('MCP constrained-collection validator uses the patched Zod release', () => {
  const fromMcp = createRequire(require.resolve('../node_modules/touchdesigner-mcp-server/dist/cli.js'));
  const { version } = fromMcp('zod/package.json');
  const [major, minor, patch] = version.split('.').map(Number);
  assert.ok(major > 4 || (major === 4 && (minor > 6 || (minor === 6 && patch >= 6))), version);
  const { z } = fromMcp('zod');
  assert.equal(z.array(z.string()).max(2).safeParse(['a', 'b', 'c']).success, false);
});

test('every lint consumer resolves the actual patched registry minimatch release', () => {
  for (const plugin of ['eslint', '@eslint/config-array', '@eslint/eslintrc', 'eslint-plugin-react', 'eslint-plugin-import', 'eslint-plugin-jsx-a11y']) {
    const fromPlugin = createRequire(require.resolve(plugin));
    assert.equal(fromPlugin('minimatch/package.json').version, '11.0.3', plugin);
    const { minimatch, Minimatch } = fromPlugin('minimatch');
    assert.equal(minimatch('Widget', 'Wid*'), true);
    assert.equal(minimatch('Other', 'Wid*'), false);
    assert.equal(new Minimatch('*.ts', { matchBase: true }).match('src/test.ts'), true);
  }
  const lock = require('../package-lock.json');
  for (const [name, pkg] of Object.entries(lock.packages)) {
    if (name.endsWith('/minimatch')) {
      assert.equal(pkg.version, '11.0.3');
      assert.equal(pkg.resolved, 'https://registry.npmjs.org/minimatch/-/minimatch-11.0.3.tgz');
      assert.match(pkg.integrity, /^sha512-/);
    }
  }
});

test('typescript-eslint uses bounded modern glob preprocessing', () => {
  const fromParser = createRequire(require.resolve('@typescript-eslint/typescript-estree'));
  const { version } = fromParser('minimatch/package.json');
  const [major, minor, patch] = version.split('.').map(Number);
  assert.ok(major > 11 || (major === 11 && (minor > 0 || patch >= 1)), version);
  const { minimatch } = fromParser('minimatch');
  assert.equal(minimatch('src/test.ts', '**/*.ts', { dot: true }), true);
});
