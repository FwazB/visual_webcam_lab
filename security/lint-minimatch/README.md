# Lint consumers of minimatch 11

The lockfile installs the real registry `minimatch@11.0.3`, including its published
integrity hash. There is no local replacement, renamed package, version shim,
advisory suppression, or disabled lint rule. The full audit gate rejects every
finding, including the former development-only exception.

Legacy plugins still import minimatch's old callable CommonJS default. Version
11 exports a named `minimatch` function and removes regex compilation APIs.
`patches.json` records the small consumer migrations, exact upstream versions,
SHA-256 hashes before and after, replacement text, and expected occurrence counts:

- `eslint-plugin-react@7.37.5`: named function import in `forbid-component-props`,
  `jsx-handler-names`, `jsx-pascal-case`, `no-danger`, and
  `no-unstable-nested-components`.
- `eslint-plugin-import@2.32.0`: named function import in `extensions`,
  `no-extraneous-dependencies`, `no-import-module-exports`, `no-namespace`,
  `no-unassigned-import`, and `order`. `no-internal-modules` compiles `Minimatch`
  objects and uses their supported `match(path)` method instead of removed
  `makeRe(pattern)` / RegExp `test(path)` calls.
- `eslint-plugin-jsx-a11y@6.10.2`: named function import in
  `mayContainChildComponent` and `mayHaveAccessibleLabel`.
- `@eslint/config-array@0.21.2` and `@eslint/eslintrc@3.3.5`: namespace imports in
  their ESM entry points, which already consume the exported `Minimatch` class.
  Their CommonJS entry points require no change.
- `eslint@9.39.4` already uses the exported class and requires no source patch;
  its version and dependency resolution are checked with the patched consumers.

Overrides target these consumers explicitly. The existing modern parser override
remains. This is a maintained dependency migration, not a claim that arbitrary
legacy users are compatible with minimatch 11. Future package updates must review
these patches and the rule regressions; unknown versions or source bytes fail
before writes. The entire patch set and every consumer's resolved minimatch
version are checked before applying changes. Re-running preparation is safe.

`npm install` / `npm ci` runs preparation through `postinstall`. CI deliberately
uses `npm ci --ignore-scripts`; `npm run lint`, `npm test`, `npm run build`, and
`npm run dev` all prepare the lint consumers explicitly first. For a direct
ESLint/editor invocation after an ignore-scripts install, run
`npm run prepare:lint` once. The ESLint config verifies preparation and gives that
command if it is missing. Production-only installs with the entire development
lint toolchain absent skip preparation.

Regression tests execute the installed rules on matching and nonmatching glob
options across every patched rule/helper, exercise ESM and CommonJS resolution,
and verify preparation failure/idempotence. They preserve import allow/forbid,
path normalization, component-name exceptions, property restrictions, import
ordering/extensions, and accessibility label requirements. They do not claim
exhaustive semantic equivalence for every possible historical glob pattern.

Remove these patches once upstream consumers adopt the modern API, then retain
the rule-level regressions and strict audit gate.
