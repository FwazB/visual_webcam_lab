'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const braces = require('./');
const { spawnSync } = require('node:child_process');

test('rejects a direct AST with a cyclic node parent without hanging', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const braces = require('./');
    const child = { type: 'other', nodes: [] };
    child.parent = child;
    assert.throws(() => braces.expand({ type: 'root', nodes: [child] }),
      { name: 'SyntaxError', message: /safe AST limits/ });
  `], { cwd: __dirname, timeout: 2000, encoding: 'utf8' });
  assert.equal(result.error, undefined, 'AST expansion must not time out');
  assert.equal(result.status, 0, result.stderr);
});
const { MAX_DEPTH } = require('./lib/guard');

test('keeps ordinary expansion, compilation, escaping and AST behavior', () => {
  assert.deepEqual(braces.expand('a/{b,c}/d'), ['a/b/d', 'a/c/d']);
  assert.deepEqual(braces.expand('{01..03}'), ['01', '02', '03']);
  assert.deepEqual(braces.expand('{a,b}{1,2}'), ['a1', 'a2', 'b1', 'b2']);
  assert.deepEqual(braces.expand('{a,,b}', { noempty: true }), ['a', 'b']);
  assert.deepEqual(braces.expand('\\{a,b\\}'), ['{a,b}']);
  assert.equal(braces.compile('a/{b,c}/d'), 'a/(b|c)/d');
  const ast = braces.parse('foo/{a,b}/bar');
  assert.equal(braces.stringify(ast), 'foo/{a,b}/bar');
  assert.equal(braces.compile(ast), 'foo/(a|b)/bar');
});

test('rejects deeply nested brace and parenthesis input before recursive walkers', () => {
  for (const [open, close] of [['{', '}'], ['(', ')']]) {
    const pattern = open.repeat(4000) + 'x,y' + close.repeat(4000);
    for (const method of ['parse', 'compile', 'expand', 'stringify']) {
      assert.throws(() => braces[method](pattern), { name: 'SyntaxError', message: /safe AST limits/ });
    }
  }
  assert.deepEqual(braces.expand('{a,b}'), ['a', 'b']);
});

test('bounds direct AST calls, cycles and excessively wide trees', () => {
  let ast = { type: 'text', value: 'a' };
  for (let i = 0; i < MAX_DEPTH + 1; i++) ast = { type: 'root', nodes: [ast] };
  const cyclic = { type: 'root', nodes: [] }; cyclic.nodes.push(cyclic);
  const wide = { type: 'root', nodes: Array.from({ length: 100001 }, () => ({ type: 'text', value: 'a' })) };
  for (const value of [ast, cyclic, wide]) {
    for (const method of ['compile', 'expand', 'stringify']) {
      assert.throws(() => braces[method](value), { name: 'SyntaxError', message: /safe AST limits/ });
    }
  }
});
