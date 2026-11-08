// Trusted pull_request_target entry: do not check out or execute candidate code.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { acceptedGit, acceptedRef, verifyRemoteAcceptance } from './accepted-source.mjs';
import { ACCEPTED_SOURCE_CHECK } from './accepted-source-policy.mjs';
export async function runAcceptedSourceCI(root, event, { repository, token, request = fetch }) {
  const pull = event.pull_request;
  assert.equal(pull.base.ref, 'main');
  assert.equal(pull.head.repo.full_name, repository, 'Forks cannot claim this repository acceptance');
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(pull.head.sha, /^[a-f0-9]{40}$/);
  assert.match(pull.head.ref, /^codex\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.match(pull.base.sha, /^[a-f0-9]{40}$/, 'GitHub trusted base SHA required');
  assert.equal(
    acceptedGit(root, ['rev-parse', 'HEAD']),
    pull.base.sha,
    'Run the verifier from the exact trusted base checkout',
  );
  const api = async (method, suffix, body) => {
    const response = await request('https://api.github.com/repos/' + repository + suffix, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, 'Cannot publish accepted-source check');
    return response.json();
  };
  const check = await api('POST', '/check-runs', {
    name: ACCEPTED_SOURCE_CHECK,
    head_sha: pull.head.sha,
    status: 'in_progress',
  });
  try {
    const batch = pull.head.ref.slice('codex/'.length),
      ref = acceptedRef(batch);
    acceptedGit(root, ['fetch', '--no-tags', 'origin', pull.head.sha, ref + ':' + ref]);
    const accepted = acceptedGit(root, ['rev-parse', ref]);
    const result = verifyRemoteAcceptance(root, {
      candidate: pull.head.sha,
      accepted,
      branch: pull.head.ref,
      trustedMain: pull.base.sha,
    });
    await api('PATCH', '/check-runs/' + check.id, {
      status: 'completed',
      conclusion: 'success',
      output: { title: 'Accepted business snapshot matches', summary: JSON.stringify(result) },
    });
    return result;
  } catch (error) {
    await api('PATCH', '/check-runs/' + check.id, {
      status: 'completed',
      conclusion: 'failure',
      output: { title: 'Accepted business snapshot blocked', summary: String(error.message).slice(0, 4000) },
    });
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAcceptedSourceCI(process.cwd(), JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH)), {
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GH_TOKEN,
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
