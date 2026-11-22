/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const gate = import("../scripts/verify-production-ci.mjs");
const repo = "FwazB/visual_webcam_lab";
const sha = "a".repeat(40);
const env = {
  VERCEL_ENV: "production", VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_REPO_OWNER: "FwazB",
  VERCEL_GIT_REPO_SLUG: "visual_webcam_lab", VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_COMMIT_SHA: sha,
};
const run = {
  head_sha: sha, head_branch: "main", event: "push", path: ".github/workflows/ci.yml",
  repository: { full_name: repo }, head_repository: { full_name: repo },
  id: 17, run_attempt: 2, status: "completed", conclusion: "success",
};
const job = { name: "Body synth checks", run_id: 17, run_attempt: 2, head_sha: sha, status: "completed", conclusion: "success" };

async function check(responses, overrides = {}) {
  const { waitForProductionCi } = await gate;
  let time = 0;
  const urls = [];
  const id = await waitForProductionCi({ ...env, ...overrides }, {
    async fetchImpl(url) {
      urls.push(url);
      const result = responses.shift();
      assert.ok(result, "unexpected GitHub call");
      return result instanceof Response ? result : Response.json(result);
    },
    async wait(ms) { time += ms; }, now: () => time,
  });
  return { id, urls };
}

test("production waits for the exact main push and succeeds only on its current attempt", async () => {
  const { id, urls } = await check([
    { workflow_runs: [] },
    { workflow_runs: [{ ...run, status: "in_progress" }] },
    { workflow_runs: [run] }, { jobs: [job] },
  ]);
  const list = `https://api.github.com/repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&per_page=1`;
  assert.equal(id, run.id);
  assert.deepEqual(urls, [list, list, list, `https://api.github.com/repos/${repo}/actions/runs/17/attempts/2/jobs?per_page=100`]);
});

test("production requires valid Vercel Git metadata without falling back to local or preview mode", async () => {
  for (const invalid of [{ VERCEL_ENV: undefined }, { VERCEL_ENV: "preview" }, { VERCEL_GIT_PROVIDER: "gitlab" },
    { VERCEL_GIT_COMMIT_SHA: undefined }, { VERCEL_GIT_COMMIT_SHA: "abc" }, { VERCEL_GIT_COMMIT_REF: "review/example" },
    { VERCEL_GIT_REPO_OWNER: "another-user" }, { VERCEL_GIT_REPO_SLUG: "other" }]) {
    await assert.rejects(check([], invalid), /Vercel production Git metadata/);
  }
});

test("production blocks failed runs, alternate branches, PRs, forks and wrong workflow or SHA", async () => {
  for (const change of [{ conclusion: "failure" }, { conclusion: "cancelled" }, { head_branch: "review/example" },
    { event: "pull_request" }, { path: ".github/workflows/other.yml" }, { head_sha: "b".repeat(40) },
    { head_repository: { full_name: "fork/visual_webcam_lab" } }]) {
    await assert.rejects(check([{ workflow_runs: [{ ...run, ...change }] }]), /GitHub/);
  }
});

test("a successful run still needs one successful matching job from its latest attempt", async () => {
  for (const jobs of [[], [job, job], [{ ...job, name: "Unrelated" }], [{ ...job, status: "queued" }],
    [{ ...job, conclusion: "skipped" }], [{ ...job, run_attempt: 1 }], [{ ...job, head_sha: "b".repeat(40) }],
    [{ ...job, run_id: 27 }]]) {
    await assert.rejects(check([{ workflow_runs: [run] }, { jobs }]), /Required job/);
  }
});

test("an unavailable GitHub API or indefinitely missing check stops production", async () => {
  await assert.rejects(check([new Response(null, { status: 403 })]), /HTTP 403/);
  await assert.rejects(check(Array.from({ length: 36 }, () => ({ workflow_runs: [] }))), /Timed out/);
});
