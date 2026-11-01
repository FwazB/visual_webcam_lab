/* eslint-disable @typescript-eslint/no-require-imports -- Exercise installed CommonJS lint rules, not mocked matchers. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Linter } = require('eslint');
const react = require('eslint-plugin-react');
const imports = require('eslint-plugin-import');
const a11y = require('eslint-plugin-jsx-a11y');

function messages(rule, options, source, filename = 'src/example.jsx') {
  const result = new Linter().verify(source, [{
    files: ['**/*.{js,jsx}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { react, import: imports, 'jsx-a11y': a11y },
    settings: { react: { version: '19.2' } },
    rules: { [rule]: ['error', ...options] },
  }], { filename: path.resolve(filename) });
  assert.ok(result.every((entry) => !entry.fatal && entry.ruleId === rule), JSON.stringify(result));
  return result;
}

test('React glob options still exempt and reject matching components and properties', () => {
  assert.equal(messages('react/jsx-pascal-case', [{ ignore: ['BAD_*'] }], '<BAD_NAME />').length, 0);
  assert.equal(messages('react/jsx-pascal-case', [{ ignore: ['GOOD_*'] }], '<BAD_NAME />').length, 1);
  const danger = '<CustomHtml dangerouslySetInnerHTML={{ __html: text }} />';
  assert.equal(messages('react/no-danger', [{ customComponentNames: ['Custom*'] }], danger).length, 1);
  assert.equal(messages('react/no-danger', [{ customComponentNames: ['Other*'] }], danger).length, 0);
  const forbidden = [{ forbid: [{ propNamePattern: 'secret*', allowedForPatterns: ['Safe*'] }] }];
  assert.equal(messages('react/forbid-component-props', forbidden, '<SafeWidget secretValue={1} />').length, 0);
  assert.equal(messages('react/forbid-component-props', forbidden, '<Widget secretValue={1} />').length, 1);
  assert.equal(messages('react/forbid-component-props', [{ forbid: [{ propName: 'data', disallowedForPatterns: ['Widget*'] }] }], '<Widget data={1} />').length, 1);
  const handler = '<Widget onClick={badName} />';
  assert.equal(messages('react/jsx-handler-names', [{ checkLocalVariables: true, ignoreComponentNames: ['Wid*'] }], handler).length, 0);
  assert.equal(messages('react/jsx-handler-names', [{ checkLocalVariables: true, ignoreComponentNames: ['Other*'] }], handler).length, 1);
  const nested = 'function Parent() { return <Widget renderThing={() => <div />} />; }';
  assert.equal(messages('react/no-unstable-nested-components', [{ propNamePattern: 'render*' }], nested).length, 0);
  assert.equal(messages('react/no-unstable-nested-components', [{ propNamePattern: 'other*' }], nested).length, 1);
});

test('import glob options preserve namespace, side-effect, and mixed-module enforcement', () => {
  const namespace = 'import * as R from "react"; R.createElement("div");';
  assert.equal(messages('import/no-namespace', [{ ignore: ['rea*'] }], namespace).length, 0);
  assert.equal(messages('import/no-namespace', [{ ignore: ['other*'] }], namespace).length, 1);
  assert.equal(messages('import/no-unassigned-import', [{ allow: ['**/*.css'] }], 'import "./style.css";').length, 0);
  assert.equal(messages('import/no-unassigned-import', [{ allow: ['**/*.css'] }], 'import "react";').length, 1);
  const mixed = 'import React from "react"; module.exports = React;';
  assert.equal(messages('import/no-import-module-exports', [{ exceptions: ['**/example.jsx'] }], mixed).length, 0);
  assert.equal(messages('import/no-import-module-exports', [{ exceptions: ['**/other.jsx'] }], mixed).length, 1);
});

test('import internal-module allow/forbid patterns use supported matcher objects', () => {
  for (const source of ['react/jsx-runtime', 'react/./jsx-runtime', 'react/x/../jsx-runtime']) {
    const code = `import runtime from ${JSON.stringify(source)};`;
    assert.equal(messages('import/no-internal-modules', [{ allow: ['react/**'] }], code).length, 0, source);
    assert.equal(messages('import/no-internal-modules', [{ forbid: ['react/**'] }], code).length, 1, source);
  }
  assert.equal(messages('import/no-internal-modules', [{ allow: ['other/**'] }], 'import runtime from "react/jsx-runtime";').length, 1);
  assert.equal(messages('import/no-internal-modules', [{ forbid: ['other/**'] }], 'import runtime from "react/jsx-runtime";').length, 0);
  assert.equal(messages('import/no-internal-modules', [{ forbid: ['react/{jsx-runtime,jsx-dev-runtime}'] }], 'import runtime from "react/jsx-runtime";').length, 1);
});

test('import extensions, order, and development-dependency patterns still affect results', () => {
  const ext = 'import x from "./something.js";';
  assert.equal(messages('import/extensions', ['never', { pattern: {}, pathGroupOverrides: [{ pattern: './*.js', action: 'ignore' }] }], ext).length, 0);
  assert.equal(messages('import/extensions', ['never'], ext).length, 1);
  const ordering = [{ groups: ['external', 'builtin'], pathGroups: [{ pattern: 'rea*', group: 'external', position: 'before' }], pathGroupsExcludedImportTypes: [] }];
  assert.equal(messages('import/order', ordering, 'import React from "react";\nimport fs from "fs";').length, 0);
  assert.equal(messages('import/order', ordering, 'import fs from "fs";\nimport React from "react";').length, 1);
  const dev = [{ devDependencies: ['**/tests/**'] }];
  assert.equal(messages('import/no-extraneous-dependencies', dev, 'import eslint from "eslint";', 'tests/example.js').length, 0);
  assert.equal(messages('import/no-extraneous-dependencies', dev, 'import eslint from "eslint";', 'src/example.js').length, 1);
});

test('accessibility custom-control globs still require both a label and matching control', () => {
  const rule = 'jsx-a11y/label-has-associated-control';
  const options = [{ controlComponents: ['Custom*'], assert: 'nesting', depth: 3 }];
  assert.equal(messages(rule, options, '<label>Name<CustomInput /></label>').length, 0);
  assert.equal(messages(rule, options, '<label><CustomInput /></label>').length, 1);
  assert.equal(messages(rule, options, '<label>Name<OtherInput /></label>').length, 1);
});

test('ESLint legacy and ESM configuration entry points load with named minimatch exports', async () => {
  const esmConfig = await import(pathToFileURL(path.resolve('node_modules/@eslint/config-array/dist/esm/index.js')));
  assert.equal(typeof esmConfig.ConfigArray, 'function');
  const esmLegacy = await import('@eslint/eslintrc');
  const tester = esmLegacy.Legacy.OverrideTester.create(['src/**/*.js'], [], process.cwd());
  assert.equal(tester.test(path.resolve('src/example.js')), true);
  assert.equal(tester.test(path.resolve('tests/example.js')), false);
});
