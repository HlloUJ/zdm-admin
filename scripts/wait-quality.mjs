import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

export async function waitQuality({
  runId,
  expectedHead,
  readRun,
  readJobs,
  wait,
  report = console.log,
  deadlineMs = 3600000,
  now = Date.now,
  progressIntervalMs = 60000,
}) {
  assert.match(String(runId), /^\d+$/);
  assert.match(expectedHead, /^[a-f0-9]{40}$/);
  const start = now();
  let lastProgress = -Infinity,
    previousJobs;
  let previous;
  let transportFailures = 0;
  while (now() - start < deadlineMs) {
    let run;
    try {
      run = await readRun();
      transportFailures = 0;
    } catch (error) {
      transportFailures++;
      if (transportFailures > 3)
        throw new Error(`CI status transport unavailable; preserve run ${runId}, never rerun tests: ${error.message}`, {
          cause: error,
        });
      report(`CI status connection interrupted; reconnect ${transportFailures}/3 for the same run.`);
      await wait(10000);
      continue;
    }
    assert.equal(String(run.id), String(runId));
    assert.equal(run.head_sha, expectedHead, 'CI candidate changed');
    assert.equal(run.run_attempt, 1, 'Workflow retries cannot grant delivery success');
    assert.equal(run.path, '.github/workflows/quality.yml');
    if (run.status !== previous) {
      report(`CI ${runId}: ${run.status}`);
      previous = run.status;
    }
    if (run.status === 'completed') {
      if (run.conclusion !== 'success')
        throw Object.assign(new Error(`CI ${runId} failed; diagnose before a new candidate`), {
          ciFailure: {
            runId: String(runId),
            headSha: run.head_sha,
            attempt: run.run_attempt,
            conclusion: run.conclusion,
            status: run.status,
          },
        });
      let jobs;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          jobs = await readJobs();
          break;
        } catch (error) {
          if (attempt === 3)
            throw new Error('Required gate status transport unavailable; preserve the same CI run', { cause: error });
          report(`CI required gate connection interrupted; reconnect ${attempt + 1}/3 for the same run.`);
          await wait(10000);
        }
      }
      for (const name of ['Frontend quality', 'Backend quality'])
        assert.equal(
          jobs.filter((job) => job.name === name && job.conclusion === 'success').length,
          1,
          `Missing required ${name}`,
        );
      const completedJobs = jobs.map((job) => Date.parse(job.completed_at)).filter(Number.isFinite);
      return {
        gatesFinishedAt: completedJobs.length ? new Date(Math.max(...completedJobs)).toISOString() : undefined,
        runId,
        headSha: expectedHead,
        eventName: run.event,
        branch: run.head_branch,
        attempt: 1,
        conclusion: 'success',
        jobs,
        elapsedMs: now() - start,
      };
    }
    if (now() - lastProgress >= progressIntervalMs) {
      lastProgress = now();
      try {
        const jobs = await readJobs();
        const summary = jobs
          .map((j) => ({
            name: j.name,
            status: j.status,
            conclusion: j.conclusion,
            active: j.steps?.filter((s) => s.status === 'in_progress').map((s) => s.name) ?? [],
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const key = JSON.stringify(summary);
        if (key !== previousJobs) {
          report(`CI ${runId} jobs: ${key}`);
          previousJobs = key;
        }
      } catch {
        // Progress is advisory. The final required-gate query above remains mandatory.
        report(`CI ${runId} progress unavailable; retain the same run and verify final gates.`);
      }
    }
    await wait(20000);
  }
  throw new Error(`CI wait timed out; preserve run ${runId}, inspect status without rerunning checks`);
}
export async function waitRemoteQuality(root, runId, expectedHead) {
  const gh = (args) => {
    const result = spawnSync('gh', args, { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, 'Cannot read remote CI status');
    return JSON.parse(result.stdout);
  };
  const repository = gh(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner;
  const api = (suffix) => gh(['api', `repos/${repository}/actions/runs/${runId}${suffix}`]);
  return waitQuality({
    runId,
    expectedHead,
    readRun: () => api(''),
    readJobs: () => api('/jobs?filter=all&per_page=100').jobs,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}

// Do not guess among multiple runs or let branch/head filters select an unrelated candidate.
export function selectQualityRun(runs, { selector, branch, head }) {
  assert.match(head, /^[a-f0-9]{40}$/);
  assert.ok(['pr', 'main'].includes(selector));
  const event = selector === 'pr' ? 'pull_request' : 'push';
  const matches = runs.filter((r) => r.headSha === head && r.headBranch === branch && r.event === event);
  assert.equal(matches.length, 1, 'Exact CI run unavailable or ambiguous; retain candidate and specify its run ID');
  assert.match(String(matches[0].databaseId), /^\d+$/);
  return String(matches[0].databaseId);
}
