import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectFixedCompletionPreview } from './completion-fixed-preview.mjs';
import { withIntegrationResource } from './integration-resource.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { createTaskRegistry } from './task-registry.mjs';
import { fixedAcceptanceReadyFact, verifyFixedAcceptanceMember } from './task-fixed-acceptance.mjs';
import { readFixedAcceptancePolicy } from './task-fixed-acceptance-intake.mjs';
import { recordToolProgress } from './task-delivery-status-sync.mjs';

function stateJournal(common, plan) {
  const directory = path.join(common, 'fixed-acceptance', 'releases');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assert.equal(realpathSync(directory), directory);
  const key = createHash('sha256')
    .update(JSON.stringify([plan.active, plan.tree, plan.members.map((task) => task.completion)]))
    .digest('hex');
  const base = path.join(directory, key);
  const journal = (event, eventData) =>
    writeFileSync(base + '.' + event + '.json', JSON.stringify({ version: 1, event, ...eventData }) + '\n', {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });
  return { journal, file: (event) => base + '.' + event + '.json' };
}

// The host supplies the actual staged release, data backup/rehearsal and switch
// adapters. Publishing never falls through to board transport on failure.
export async function publishFixedAcceptance(
  root,
  { plan, prepare, switchPreview, restorePreview, deliver },
  adapters = {},
) {
  const { commonDir } = adapters.registry ?? createTaskRegistry(root);
  const policy = (adapters.policy ?? readFixedAcceptancePolicy)(commonDir);
  assert.ok(
    policy?.executor && (adapters.actor ?? process.env.CODEX_THREAD_ID) === policy.executor,
    'Exact fixed acceptance executor required',
  );
  assert.equal(plan.previewOnly, true);
  assert.ok(plan.members.length > 0);
  for (const fn of [prepare, switchPreview, restorePreview, deliver]) assert.equal(typeof fn, 'function');

  const inspect = adapters.inspect ?? inspectFixedCompletionPreview;
  const verify = adapters.verify ?? ((task) => verifyFixedAcceptanceMember(root, task));
  const record =
    adapters.record ??
    ((proof) =>
      recordToolProgress(
        path.join(commonDir, 'task-progress', proof.board),
        proof.board,
        'fixed-acceptance:' + proof.publication + ':' + proof.development,
        fixedAcceptanceReadyFact(proof),
      ));
  const leases = createResourceLeases(commonDir);
  const guard =
    adapters.guard ??
    ((action) =>
      withIntegrationResource(root, 'fixed-5179-acceptance-preview', () =>
        leases.run('temporary-port-5179', 'fixed-5179-acceptance-preview', () =>
          leases.run('backend-port-8081', 'fixed-5179-acceptance-preview', action),
        ),
      ));
  const state = stateJournal(commonDir, plan);

  // Transport errors may be reconciled against the same publication. They do
  // not re-run deployment or restore a healthy release after user data can flow.
  let recovered = null;
  if (existsSync(state.file('verified'))) {
    recovered = JSON.parse(readFileSync(state.file('verified'), 'utf8'));
    assert.equal(recovered.version, 1);
    assert.equal(recovered.release, plan.candidate);
  }
  let initial, staged;
  if (!recovered) {
    assert.ok(!existsSync(state.file('prepared')), 'Previous cutover outcome requires readback before another attempt');
    initial = await inspect(commonDir);
    assert.equal(initial.head, plan.active);
    staged = await prepare({ plan, initial });
    assert.equal(staged?.head, plan.candidate);
    assert.equal(staged?.tree, plan.tree);
    assert.equal(staged?.featureVerification, true);
    assert.equal(staged?.rollbackVerified, true);
    if (plan.affectedBackend) assert.equal(staged?.isolatedBackendVerified, true);
    if (plan.migrations.length > 0) {
      assert.equal(staged?.migrationRehearsed, true);
      assert.match(staged?.backupSha256 ?? '', /^[a-f0-9]{64}$/);
      assert.ok(path.isAbsolute(staged.backup) && lstatSync(staged.backup).isFile());
      assert.equal(realpathSync(staged.backup), staged.backup);
      const backupHash = createHash('sha256');
      for await (const bytes of createReadStream(staged.backup)) backupHash.update(bytes);
      assert.equal(backupHash.digest('hex'), staged.backupSha256, 'Migration backup differs from rehearsal');
    }
  }
  const verified = await guard(async () => {
    const proofs = async () => {
      const result = [];
      for (const member of plan.members) {
        const proof = await verify(member.task);
        assert.equal(proof.candidate, member.head);
        assert.equal(proof.development, member.completion);
        assert.equal(proof.release, plan.candidate);
        result.push(proof);
      }
      return result;
    };
    if (recovered) {
      const live = await inspect(commonDir);
      assert.equal(live.head, recovered.release);
      return proofs();
    }
    assert.ok(!existsSync(state.file('prepared')), 'Concurrent preview activation requires readback');
    assert.equal(
      (await inspect(commonDir)).proofDigest,
      initial.proofDigest,
      'Current fixed preview changed during preparation',
    );
    state.journal('prepared', { previous: initial.head, release: plan.candidate });
    try {
      await switchPreview({ plan, initial, staged });
      const live = await inspect(commonDir);
      assert.equal(live.head, plan.candidate);
      const accepted = await proofs();
      state.journal('verified', { release: live.head, publication: accepted[0].publication });
      return accepted;
    } catch (error) {
      let journalFailure;
      try {
        state.journal('failed', { reason: error.message });
      } catch (failure) {
        journalFailure = failure;
      }
      try {
        await restorePreview({ plan, initial, staged });
        const restored = await inspect(commonDir);
        assert.equal(restored.head, initial.head, 'Previous fixed preview did not recover');
        assert.equal(restored.worktree, initial.worktree);
        assert.equal(restored.branch, initial.branch);
        state.journal('restored', { release: restored.head });
      } catch (recoveryError) {
        throw new AggregateError([error, recoveryError], 'Fixed acceptance cutover and recovery require attention', {
          cause: recoveryError,
        });
      }
      if (journalFailure)
        throw new AggregateError([error, journalFailure], 'Previous release restored; journal needs attention', {
          cause: error,
        });
      throw error;
    }
  });
  const placement = [];
  for (const proof of verified) {
    const entry = await record(proof);
    const readback = await deliver({ proof, entry });
    assert.equal(readback.receipt_id, entry.receipt_id, 'Fixed acceptance board receipt differs');
    assert.ok(['applied', 'duplicate'].includes(readback.status), 'Fixed acceptance board receipt remains unconfirmed');
    assert.equal(readback.task?.id, proof.board);
    assert.equal(readback.task.board_column, 'review');
    assert.ok(Number.isSafeInteger(readback.task.revision));
    placement.push({ task: proof.board, revision: readback.task.revision, receipt: entry.receipt_id });
  }
  return { release: plan.candidate, placement };
}

// Load the specifically registered native host. No job can nominate its own
// executable or provide a substitute authorization through command arguments.
export async function loadFixedAcceptanceHost(common, policy) {
  assert.match(policy.hostSha256 ?? '', /^[a-f0-9]{64}$/, 'Verified fixed acceptance host required');
  const file = path.join(common, 'fixed-acceptance/host.mjs');
  assert.ok(lstatSync(file).isFile() && realpathSync(file) === file, 'Unsafe fixed acceptance host');
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), policy.hostSha256);
  const { prepare, switchPreview, restorePreview, deliver } = await import(pathToFileURL(file));
  for (const operation of [prepare, switchPreview, restorePreview, deliver]) assert.equal(typeof operation, 'function');
  return { prepare, switchPreview, restorePreview, deliver };
}

export function registerFixedAcceptancePlan(common, member, build) {
  assert.match(member.completion, /^[a-f0-9]{64}$/);
  const directory = path.join(common, 'fixed-acceptance/plans');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assert.equal(realpathSync(directory), directory);
  const filename = path.join(directory, member.completion + '.json');
  if (!existsSync(filename)) {
    const plan = build();
    try {
      writeFileSync(filename, JSON.stringify(plan) + '\n', { flag: 'wx', mode: 0o600, flush: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  assert.ok(lstatSync(filename).isFile() && realpathSync(filename) === filename);
  const plan = JSON.parse(readFileSync(filename, 'utf8'));
  assert.equal(plan.members.length, 1);
  for (const field of ['task', 'board', 'head', 'completion', 'worktree'])
    assert.equal(plan.members[0][field], member[field]);
  return plan;
}
