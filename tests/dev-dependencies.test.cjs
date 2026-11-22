/* eslint-disable @typescript-eslint/no-require-imports -- Verify the CommonJS APIs actually consumed by lint plugins. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

test('the project does not install or register the withdrawn TouchDesigner MCP', () => {
  const lock = require('../package-lock.json');
  assert.ok(!Object.keys(lock.packages).some(name => name.endsWith('/touchdesigner-mcp-server')));
  const configPath = path.join(__dirname, '..', '.mcp.json');
  if (fs.existsSync(configPath)) {
    const { mcpServers } = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(!mcpServers?.touchdesigner);
    assert.doesNotMatch(JSON.stringify(mcpServers ?? {}), /touchdesigner-mcp-server/);
  }
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
