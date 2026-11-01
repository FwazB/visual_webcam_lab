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

test('legacy lint plugins retain callable minimatch and makeRe APIs', () => {
  for (const plugin of ['eslint-plugin-react', 'eslint-plugin-import', 'eslint-plugin-jsx-a11y']) {
    const fromPlugin = createRequire(require.resolve(plugin));
    const match = fromPlugin('minimatch');
    assert.equal(typeof match, 'function', `${plugin} requires a callable CommonJS export`);
    assert.equal(match('Widget', 'Wid*'), true);
    assert.equal(match('Other', 'Wid*'), false);
    assert.equal(match.makeRe('src/**/*.ts').test('src/lib/test.ts'), true);
    assert.equal(new match.Minimatch('*.ts', { matchBase: true }).match('src/test.ts'), true);
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
