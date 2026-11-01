# GitHub checks → merge → Vercel Git deployment

## Required external setup (not implemented by these files)

Before pushing, verify the exact GitHub destination, visibility and Vercel project link. Before merging, an administrator must configure and verify an enforced `main` ruleset/branch protection:

- Require a pull request and successful **Body synth checks**, from the GitHub Actions app.
- Require the branch to be up to date before merging. No direct pushes, force pushes, deletions or administrator/bot bypass of the required checks.
- Do not require the Vercel preview check: previews are deliberately disabled. Do not enable a merge queue without first adding and testing the `merge_group` workflow event.
- Keep Vercel connected to the intended repository with Production Branch `main`; confirm project root and Node 24.x. The Vercel Git integration, not a CLI command or an Actions deployment token, deploys the merged main commit.

The expected link is project `body-synth` → `FwazB/visual_webcam_lab`, root repository directory. That is supplied project context, not proof that rules are configured. GitHub settings access is an external prerequisite; SSH push access alone cannot establish this protection.

## Source policy

`vercel.json` uses `git.deploymentEnabled: {"**": false, "main": true}`. Vercel documents minimatch patterns, default-enabled unspecified branches, and true winning when multiple rules match. `**` also catches slash-containing branches. Only main is enabled; even a green safety branch does **not** deploy a preview.

Include this config in the first candidate push. Inspect the Vercel event to verify the branch is skipped before proceeding. A branch that removes/changes this config is not protected by another branch's file. This is not an account-wide guard or a restriction on manual/API/CLI deployments.

CI runs on pushes to `main`, `safety/**`, `review/**` and PRs targeting `main`. Checks use pinned action commits, read-only contents permission, no persisted checkout credentials, no project secrets, separate push/PR concurrency groups and bounded timeouts.

A successful PR check followed by an enforced merge is the ordering mechanism. This config does **not** cause Vercel to wait for a check on a new main push: post-merge Actions and Vercel may run concurrently. Direct main pushes/bypasses would break the intended guarantee. Main branch protection must be verified, not assumed.

## Checks and limits

Node 24: locked clean install without lifecycle scripts, valid dependency tree, lint, app tests, Python Fuzz tests, fork security regressions, production build, production audit failing at **low** severity, then the narrow all-dependency policy.

The all-dependency gate prints the full npm audit report and accepts only the recorded development-only `minimatch@3.1.5` advisory `GHSA-g3hv-75wg-m249`, its reviewed dependent names, moderate severity, and at most 15 aggregate findings. It checks lockfile dev flags; new advisory IDs, production exposure, severity changes, versions, names and malformed reports fail. Production audit has no exception. This is **not a clean full audit** and does not promise every upstream risk is known. See the existing security audit document for the accepted discrepancy and reassessment conditions.

No live Spotify, TouchDesigner, physical instrument/camera/audio, private playing-vision fixtures or model-weight tests run in this workflow. Those remain separate release evidence; no private fixtures are published for CI.

## Official references

- https://vercel.com/docs/project-configuration/git-configuration
- https://vercel.com/docs/git/vercel-for-github
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

Action refs were resolved directly from the official `actions/checkout` and `actions/setup-node` repositories; update immutable pins only after reviewing upstream.
