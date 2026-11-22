import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const repository = "FwazB/visual_webcam_lab";
const api = `https://api.github.com/repos/${repository}/actions`;
const workflow = ".github/workflows/ci.yml";
const jobName = "Body synth checks";
const pollMs = 30_000;
const waitMs = 18 * 60_000;

export async function waitForProductionCi(env, { fetchImpl = fetch, wait = sleep, now = Date.now } = {}) {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  const source = `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`.toLowerCase();
  if (env.VERCEL_ENV !== "production" || env.VERCEL_GIT_PROVIDER !== "github" ||
      source !== repository.toLowerCase() || env.VERCEL_GIT_COMMIT_REF !== "main" ||
      !/^[a-f0-9]{40}$/.test(sha ?? "")) {
    throw new Error("Expected Vercel production Git metadata for FwazB/visual_webcam_lab on main.");
  }

  const deadline = now() + waitMs;
  async function get(path) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error("Timed out waiting for GitHub Actions.");
    const response = await fetchImpl(api + path, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "body-synth-production-check" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(Math.min(10_000, remaining)),
    });
    if (!response.ok) throw new Error(`GitHub Actions returned HTTP ${response.status}.`);
    return response.json();
  }

  while (now() < deadline) {
    const { workflow_runs: runs } = await get(`/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&per_page=1`);
    const run = runs[0];
    if (run) {
      if (run.event !== "push" || run.path !== workflow || run.head_branch !== "main" ||
          run.head_sha !== sha || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
          !Number.isSafeInteger(run.id) || run.id < 1 || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) {
        throw new Error("GitHub returned a run with unexpected workflow or source metadata.");
      }
      if (run.status === "completed") {
        if (run.conclusion !== "success") throw new Error(`GitHub CI run ${run.id} concluded ${run.conclusion}.`);
        const { jobs } = await get(`/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
        const checks = jobs.filter(job => job.name === jobName);
        const job = checks[0];
        if (checks.length !== 1 || job.run_id !== run.id || job.run_attempt !== run.run_attempt ||
            job.head_sha !== sha || job.status !== "completed" || job.conclusion !== "success") {
          throw new Error(`Required job "${jobName}" did not pass for this commit and run attempt.`);
        }
        return run.id;
      }
    }
    await wait(Math.max(0, Math.min(pollMs, deadline - now())));
  }
  throw new Error("Timed out waiting for GitHub Actions.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const id = await waitForProductionCi(process.env);
    console.log(`Production CI verified: https://github.com/${repository}/actions/runs/${id}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
