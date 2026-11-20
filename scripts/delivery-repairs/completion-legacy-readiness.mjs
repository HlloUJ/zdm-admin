import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

const legacy = Object.freeze({
  repository: 'hllouj/zdm-admin',
  task: 'scheduled-manifest-cleanup',
  branch: 'codex/scheduled-manifest-cleanup',
  head: 'a358d49a2a3b5d7932d74906ceae9dfd7f85849d',
  accepted: '3b35c1ff2134e5f3136d569352fd13cc70432cc4',
  pr: 135,
  merge: '28c09e7f896d0e5f3a37abb890b3e1a64ed2173c',
  event: 'dd8baa15-a0aa-493d-8dcb-3b784b659c97',
  candidateDigest: '38ab2be53765c54976841f059b8e84825a344c8311323ba41d89a54bc00b022c',
  packetDigest: 'b2d4178ae4fd2723e61af1046f818dfcec91ff36bbed3c8576fa9a2c1b5c9c9b',
  archiveDirectoryDigest: 'feed1b9b6a7ee16ee00c40fbfa69b04e1a7f46cf09f149fe0e00d3d8f2dd1bb5',
  registrationDigest: 'b58c89b5b4df809b42f211c5167b7f9f9d8520747ba797b9050a1dcdf58bd944',
  command: 'node scripts/verify.mjs --affected --browser chrome',
});
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const phaseNames = [
  'delivery input contracts',
  'changed format check',
  'changed lint',
  'CI reuse contract preflight',
  'changed script tests',
];

function readVerifiedFile(file, { ownerOnly = true } = {}) {
  assert.ok(path.isAbsolute(file) && realpathSync(file) === file, 'Linked or invalid readiness proof path');
  const info = lstatSync(file);
  assert.ok(
    info.isFile() && info.nlink === 1 && info.size <= 2 * 1024 ** 2 && (!ownerOnly || !(info.mode & 0o077)),
    'Unsafe readiness proof file',
  );
  return readFileSync(file);
}

function proofFile(directory, details, name) {
  const bytes = readVerifiedFile(path.join(directory, name));
  assert.equal(sha(bytes), details.copies?.[name]?.sha256, 'Legacy readiness proof differs: ' + name);
  return bytes;
}

const originalOrigins = new Set([
  'git@github.com:' + legacy.repository + '.git',
  'ssh://git@github.com/' + legacy.repository + '.git',
  'https://github.com/' + legacy.repository + '.git',
  'https://github.com/' + legacy.repository,
]);

function originalRegistration(batch, common, { repository, origin, anchorCommon, worktreeCommon, registration }) {
  if (
    repository?.toLowerCase() !== legacy.repository ||
    !originalOrigins.has(origin?.toLowerCase()) ||
    common !== batch.repository.commonDir ||
    common !== anchorCommon ||
    common !== worktreeCommon ||
    common !== registration?.repository?.commonDir ||
    batch.worktree !== registration.worktree ||
    registration.version !== 2 ||
    registration.id !== legacy.task ||
    registration.branch !== legacy.branch ||
    registration.recordedHead !== legacy.head ||
    registration.frozen?.accepted !== legacy.accepted
  )
    return false;
  const binding = registration.executionBindings?.[0];
  if (!binding || binding.taskId !== legacy.task || binding.commonDir !== common || binding.worktree !== batch.worktree)
    return false;
  // Bind the real paths and immutable registration facts without publishing
  // their private values. Later ordinary registry revisions do not change them.
  return (
    sha(
      JSON.stringify([
        batch.repository.anchor,
        common,
        registration.worktree,
        registration.id,
        registration.branch,
        registration.createdAt,
        registration.owner,
        registration.base,
        registration.startHead,
        registration.frozen.accepted,
        binding.revision,
        binding.boundAt,
        binding.request?.messageId,
        binding.quiescenceDigest,
      ]),
    ) === legacy.registrationDigest
  );
}

function originalArchive(worktree) {
  const root = path.join(worktree, '.task-verification', 'task-cleanup');
  const matches = readdirSync(root, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && sha(entry.name) === legacy.archiveDirectoryDigest,
  );
  assert.equal(matches.length, 1, 'One reviewed legacy readiness archive is required');
  return path.join(root, matches[0].name);
}

function assertEvidenceUnder(file, root, directory) {
  assert.ok(
    typeof file === 'string' && path.isAbsolute(file) && path.relative(root, file).startsWith(directory + path.sep),
    'Legacy readiness evidence belongs to another carrier',
  );
}

// The old prepare event records a successful measured command using HEAD as its key.
// Only the reviewed, digest-pinned packet for this already-merged task can establish what ran.
export function hasOriginalMergedReadiness({
  batch,
  head,
  pr,
  events,
  common,
  readCandidateCommand,
  readRegistration,
}) {
  if (
    events.some((event) => event.name === 'prepare' && event.key === head + ':readiness' && event.status === 'success')
  )
    return true;
  if (
    batch.taskRegistryVersion !== 2 ||
    batch.id !== legacy.task ||
    batch.branch !== legacy.branch ||
    batch.frozen?.accepted !== legacy.accepted ||
    head !== legacy.head ||
    pr?.number !== legacy.pr ||
    pr.mergeCommit?.oid !== legacy.merge ||
    pr.url?.toLowerCase() !== 'https://github.com/' + legacy.repository + '/pull/' + legacy.pr
  )
    return false;
  if (!originalRegistration(batch, common, readRegistration())) return false;

  const matches = events.filter((event) => event.id === legacy.event);
  assert.equal(matches.length, 1, 'One original legacy readiness event is required');
  const [event] = matches;
  assert.equal(event.name, 'prepare');
  assert.equal(event.key, head);
  assert.equal(event.status, 'success');
  assert.deepEqual(event.result, { exitCode: 0 });

  const directory = originalArchive(batch.worktree);
  const packet = readVerifiedFile(path.join(directory, 'evidence.json'));
  assert.equal(sha(packet), legacy.packetDigest, 'Reviewed legacy readiness packet differs');
  const details = JSON.parse(packet);
  const readiness = details.readiness;
  assert.deepEqual(readiness.originalEvent, event, 'Original readiness event differs from the reviewed packet');
  assert.deepEqual(readiness.command, ['measure', 'prepare', '--', 'npm', 'run', 'verify:delivery']);
  assert.equal(event.finishedAt - event.startedAt, readiness.originalElapsedMs);
  assert.equal(readiness.expandedCommand, legacy.command);
  assert.equal(readCandidateCommand(), legacy.command, 'Original candidate readiness command differs');

  assertEvidenceUnder(readiness.historicalScript, batch.repository.anchor, '.task-runtime');
  const historicalScript = readVerifiedFile(readiness.historicalScript, { ownerOnly: false });
  assert.equal(sha(historicalScript), readiness.scriptSha256, 'Original command source differs');

  assert.equal(event.processes.length, 1, 'Exact original measured process required');
  const [{ token }] = event.processes;
  assert.match(token, /^[0-9a-f-]{36}$/);
  const sealed = proofFile(directory, details, 'readiness-process.json');
  assert.deepEqual(
    readVerifiedFile(path.join(common, 'task-delivery', legacy.task, 'process-' + token + '.json')),
    sealed,
    'Original measured process journal differs',
  );
  const process = JSON.parse(sealed);
  assert.equal(process.token, token);
  assert.equal(process.status, 'quiescent');
  assert.equal(process.exitCode, 0);

  const performanceBytes = proofFile(directory, details, 'readiness-performance.json');
  const performanceSource = details.copies['readiness-performance.json'].source;
  assertEvidenceUnder(performanceSource, batch.worktree, path.join('.task-verification', 'runs'));
  assert.deepEqual(
    readVerifiedFile(performanceSource, { ownerOnly: false }),
    performanceBytes,
    'Original local readiness report differs',
  );
  const performance = JSON.parse(performanceBytes);
  assert.deepEqual(performance.candidate, { head, digest: legacy.candidateDigest });
  assert.equal(performance.standard.level, 'R4');
  assert.equal(performance.elapsedMs, readiness.reportElapsedMs);
  assert.equal(performance.exitCode, 0);
  assert.deepEqual(
    performance.phases.map((phase) => phase.name),
    phaseNames,
  );
  for (const phase of performance.phases) {
    assert.equal(phase.exitCode, 0);
    assert.equal(phase.reused, false);
    const evidence = 'readiness-phase-proofs/' + path.basename(phase.evidence);
    const proof = JSON.parse(proofFile(directory, details, evidence));
    assert.equal(proof.name, phase.name);
    assert.equal(proof.executed, true);
    assert.equal(proof.exitCode, 0);
    assert.equal(proof.commandExitCode, 0);
    assert.equal(proof.candidate.digest, legacy.candidateDigest);
    assert.equal(proof.candidateAfter.digest, legacy.candidateDigest);
    const started = Date.parse(proof.startedAt);
    const completed = Date.parse(proof.completedAt);
    assert.ok(event.startedAt <= started && started <= completed && completed <= event.finishedAt);
    const log = proofFile(directory, details, 'readiness-phase-logs/' + path.basename(proof.log));
    assert.equal(sha(log), proof.logDigest, 'Original readiness phase log differs');
  }
  return true;
}
