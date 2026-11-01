'use strict';

// GHSA-vfj7-8cjw-p6xm: bound depth before entering recursive AST walkers.
// Parent/prev links in a normal braces AST are intentionally not traversed.
const MAX_DEPTH = 128;
const MAX_NODES = 100000;
const fail = () => { throw new SyntaxError('Brace pattern exceeds safe AST limits'); };
const guard = ast => {
  const pending = [[ast, 0]];
  const seen = new Set();
  let count = 0;
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (!node || typeof node !== 'object') throw new TypeError('Expected an AST node');
    if (depth > MAX_DEPTH || ++count > MAX_NODES || seen.has(node)) fail();
    seen.add(node);
    if (node.nodes !== undefined) {
      if (!Array.isArray(node.nodes)) throw new TypeError('Expected AST nodes');
      // Check before enqueueing to avoid allocating an unbounded work list.
      if (node.nodes.length > MAX_NODES - count || pending.length + node.nodes.length > MAX_NODES) fail();
      for (const child of node.nodes) pending.push([child, depth + 1]);
    }
  }
};
module.exports = { guard, MAX_DEPTH, fail };
