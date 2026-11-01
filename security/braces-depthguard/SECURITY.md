# Local security patch

Source: npm `braces@3.0.3`, upstream https://github.com/micromatch/braces/tree/3.0.3. Upstream MIT LICENSE and authorship are preserved. Package archive SHA-512: `yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`.

This renamed private fork adds bounded-input hardening related to GHSA-vfj7-8cjw-p6xm (CVE-2026-93687). GitHub marked that advisory withdrawn on 2026-10-23; this is local defense-in-depth, not a claim of an active upstream advisory or a published security fix. Its version remains 3.0.3.

Changes: enforce a non-configurable parser stack limit of 128; iteratively validate direct AST inputs before compile, expand and stringify, rejecting excessive depth (128), nodes (100000), repeated nodes/cycles, and malformed node arrays. Expansion also bounds parent-pointer traversal. Ordinary patterns keep upstream behavior. Over-limit inputs throw a controlled SyntaxError before recursive traversal. These limits cannot be disabled through options.

Run `node --test security.test.cjs`. The consuming lockfile must resolve `braces` to this package, not upstream. Remove the fork once an upstream release contains equivalent protections.

The application declares this fork as its direct `braces` development dependency, satisfying micromatch's existing `^3.0.3` requirement. Its `.npmrc` sets `install-links=true` so clean installs package the local source and install its dependencies. `tests/glob-security.test.cjs` exercises the installed micromatch dependency after a clean install.
