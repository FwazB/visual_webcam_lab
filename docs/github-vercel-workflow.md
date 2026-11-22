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

GitHub branch protection controls who may change `main` and which checks must pass before merging. Verify the enforced rules in GitHub. Someone with unrestricted write access could change both the workflow and the build guard.

Vercel's build command waits for the audited repository's `.github/workflows/ci.yml` on the exact `main` push before compiling the app. The guard checks the production Git metadata, the run's source repository, branch, event and commit, and the **Body synth checks** job on that run attempt. GitHub Actions still uses `npm run build` directly.

Enable Vercel system environment variables for the linked Git project. The guard reads public GitHub Actions metadata without credentials and polls every 30 seconds for up to 18 minutes. A missing Git identity, failed job, API error or timeout stops the deployment. After fixing the cause, confirm the check passed on that commit and redeploy through the linked project. [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)

## Checks and limits

Node 24: locked clean install without lifecycle scripts, valid dependency tree, lint, app tests, Python Fuzz tests, fork security regressions, production build, production audit failing at **low** severity, then the narrow all-dependency policy.

The all-dependency gate fails on every production or development advisory. The
previous minimatch exception was removed after the registry upgrade and the
hash-checked compatibility patches described in the security audit. Production
audit also fails at low severity. A clean registry result is a dated check for
known advisories, not a guarantee that every dependency is harmless.

No live Spotify, TouchDesigner, physical instrument/camera/audio, private playing-vision fixtures or model-weight tests run in this workflow. Those remain separate release evidence; no private fixtures are published for CI.

## Official references

- https://vercel.com/docs/project-configuration/git-configuration
- https://vercel.com/docs/git/vercel-for-github
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

Action refs were resolved directly from the official `actions/checkout` and `actions/setup-node` repositories; update immutable pins only after reviewing upstream.
