import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectFixedCompletionPreview } from './completion-fixed-preview.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import { createTaskRegistry } from './task-registry.mjs';
import { taskExecutor, taskMonitoring } from './task-execution-binding.mjs';
import { composeFixedAcceptance } from './task-fixed-acceptance-compose.mjs';
import { createProgressOutbox } from './task-progress-outbox.mjs';
import { readFixedAcceptancePolicy } from './task-fixed-acceptance-intake.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isTaskId = (value) => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const headPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const origin = 'http://127.0.0.1:5179';

function readOwnedJson(root, relative, limit = 1024 * 1024) {
  const file = path.join(root, relative);
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, 'Invalid fixed acceptance evidence file');
  assert.equal(realpathSync(file), file, 'Linked fixed acceptance evidence refused');
  const bytes = readFileSync(file);
  return { value: JSON.parse(bytes), digest: sha256(bytes) };
}

function currentDevelopment(registry, queue, id) {
  assert.ok(isTaskId(id), 'Exact registered task ID required');
  const task = registry.resolve({ id });
  assert.equal(task.kind, 'business');
  assert.equal(task.stage, 'developing');
  assert.ok(!task.paused && !task.humanPause && !task.frozen && !task.previewOnly && !task.recovery?.runtimeBlocked);
  const ticket = queue.tickets.find((entry) => entry.lane === 'development' && entry.task === id);
  assert.equal(ticket?.status, 'completed', 'Development completion receipt required');
  assert.equal(ticket.owner, task.owner);
  assert.ok(isTaskId(ticket.monitorContext?.taskStableId), 'Exact board identity missing from development record');
  assert.match(ticket.completion?.digest ?? '', digestPattern);
  assert.match(ticket.completion?.evidence?.head ?? '', headPattern);
  return { task, ticket, board: ticket.monitorContext.taskStableId };
}

export async function pendingFixedAcceptance(root, replacements = {}) {
  const registry = replacements.registry ?? createTaskRegistry(root);
  const policy = (replacements.readPolicy ?? readFixedAcceptancePolicy)(registry.commonDir);
  assert.ok(policy, 'Fixed acceptance is not enabled');
  const queue = (replacements.readQueue ?? (() => createExecutionOrder(registry.commonDir).read()))();
  const { verifyDevelopmentCompletion } = await import('./task-execution-order-cli.mjs');
  const verifyDevelopment = replacements.verifyDevelopment ?? verifyDevelopmentCompletion;
  const initial = new Set(policy.initialCompletions);
  const approved = queue.tickets
    .filter(
      (ticket) =>
        ticket.lane === 'development' && ticket.status === 'completed' && !initial.has(ticket.completion?.digest),
    )
    .sort((first, second) => first.order - second.order);
  const pending = [];
  const blocked = [];
  for (const ticket of approved) {
    const known = registry.readTask(ticket.task);
    if (!known || known.kind !== 'business' || known.stage === 'closed') continue;
    try {
      const { task, board } = currentDevelopment(registry, queue, ticket.task);
      assert.equal(verifyDevelopment(task, ticket.completion.evidence), true);
      const previous = createProgressOutbox(path.join(registry.commonDir, 'task-progress', board)).read();
      const verified = previous.acknowledged.some(
        ({ receipt, readback }) =>
          receipt.stage_fact?.kind === 'development_ready' &&
          receipt.stage_fact.references.candidate === ticket.completion.evidence.head &&
          receipt.evidence_refs.includes('development-receipt:' + ticket.completion.digest) &&
          readback.task?.id === board &&
          readback.task.board_column === 'review',
      );
      if (verified) continue;
      pending.push({
        task: task.id,
        board,
        head: ticket.completion.evidence.head,
        completion: ticket.completion.digest,
        worktree: task.worktree,
      });
    } catch (error) {
      blocked.push({ task: ticket.task, completion: ticket.completion?.digest, reason: error.message });
    }
  }
  return { revision: queue.revision, pending, blocked };
}

function verifyFeatureReport(worktree, member, releaseHead) {
  assert.match(member.report?.sha256 ?? '', digestPattern);
  assert.match(member.report?.file ?? '', /^\.task-runtime\/acceptance\/[a-z0-9-]+\.json$/);
  const { value, digest } = readOwnedJson(worktree, member.report.file);
  assert.equal(digest, member.report.sha256, 'Fixed acceptance report changed');
  assert.equal(value.version, 1);
  assert.equal(value.task, member.task);
  assert.equal(value.head, member.head);
  assert.equal(value.releaseHead, releaseHead);
  assert.equal(value.origin, origin);
  assert.equal(value.outcome, 'passed');
  assert.ok(Number.isFinite(Date.parse(value.verifiedAt)));
  assert.ok(value.checks?.length > 0 && value.checks.every((check) => check?.passed === true && check.name));
  return value;
}

export async function verifyFixedAcceptanceMember(root, id, replacements = {}) {
  const registry = replacements.registry ?? createTaskRegistry(root);
  const queue = (replacements.readQueue ?? (() => createExecutionOrder(registry.commonDir).read()))();
  const { task, ticket, board } = currentDevelopment(registry, queue, id);
  const { verifyDevelopmentCompletion } = await import('./task-execution-order-cli.mjs');
  assert.equal((replacements.verifyDevelopment ?? verifyDevelopmentCompletion)(task, ticket.completion.evidence), true);
  const live = await (replacements.inspect ?? inspectFixedCompletionPreview)(registry.commonDir);
  const { value: release, digest } = readOwnedJson(live.worktree, '.task-runtime/acceptance/verified-release.json');
  assert.equal(release.version, 2);
  assert.equal(release.port, 5179);
  assert.equal(release.head, live.head, 'Current 5179 source differs from verified release');
  assert.equal(release.branch, live.branch);
  assert.equal(release.backendId, live.backendId, 'Current 5179 backend differs from verified release');
  assert.equal(release.configDigest, live.configDigest, 'Current 5179 binding differs from verified release');
  assert.ok(Array.isArray(release.members));
  const matches = release.members.filter((entry) => entry.task === id);
  assert.equal(matches.length, 1, 'Exact development member must be present on 5179');
  const [member] = matches;
  assert.equal(member.board, board);
  assert.equal(member.head, ticket.completion.evidence.head, 'Current 5179 contains a different development HEAD');
  assert.equal(member.completion, ticket.completion.digest, 'Current 5179 contains a different development receipt');
  const report = verifyFeatureReport(live.worktree, member, live.head);
  return {
    task: id,
    board,
    candidate: member.head,
    development: member.completion,
    release: live.head,
    publication: digest,
    verification: member.report.sha256,
    verifiedAt: report.verifiedAt,
  };
}

export function fixedAcceptanceReadyFact(data) {
  return {
    observed_at: data.verifiedAt,
    action: { id: 'fixed-acceptance:' + data.publication, label: '固定 5179 验收已就绪' },
    event: 'completed',
    evidence_refs: [
      'fixed-acceptance:' + data.publication,
      'fixed-acceptance-verification:' + data.verification,
      'development-receipt:' + data.development,
      '5179:' + data.release,
    ],
    next: { kind: 'action', label: '在固定 5179 验收' },
    stage_fact: {
      kind: 'development_ready',
      conditions: { development_complete: true, verification_passed: true, no_known_defects: true },
      references: { candidate: data.candidate, verification: 'fixed-acceptance-verification:' + data.verification },
    },
  };
}

export async function checkFixedAcceptanceReview(directory, receipt, options = {}) {
  if (receipt.stage_fact?.kind !== 'development_ready' || path.basename(path.dirname(directory)) !== 'task-progress')
    return;
  const common = path.dirname(path.dirname(directory));
  if (!(options.readPolicy ?? readFixedAcceptancePolicy)(common)) return;
  const registry = options.registry ?? createTaskRegistry(common);
  const tasks = registry
    .list()
    .filter((task) => task.id === receipt.task_id || taskMonitoring(task)?.taskStableId === receipt.task_id);
  assert.equal(tasks.length, 1, 'Review receipt does not resolve to an exact registered task');
  const [task] = tasks;
  if (task.kind !== 'business') return;
  const proof = await verifyFixedAcceptanceMember(common, task.id, { ...options, registry });
  assert.equal(proof.board, receipt.task_id);
  assert.equal(receipt.stage_fact.references.candidate, proof.candidate);
  assert.ok(
    receipt.evidence_refs.includes('fixed-acceptance:' + proof.publication),
    'Review receipt lacks exact 5179 evidence',
  );
  assert.ok(receipt.evidence_refs.includes('fixed-acceptance-verification:' + proof.verification));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, id, ...rest] = process.argv.slice(2);
    assert.equal(rest.length, 0);
    let result;
    if (command === 'pending') {
      assert.equal(id, undefined);
      result = await pendingFixedAcceptance(process.cwd());
    } else if (command === 'plan' || command === 'reconcile') {
      assert.equal(id, undefined);
      const root = process.cwd();
      const registry = createTaskRegistry(root);
      const policy = readFixedAcceptancePolicy(registry.commonDir);
      assert.ok(policy, 'Fixed acceptance is not enabled');
      assert.equal(process.env.CODEX_THREAD_ID, policy.executor, 'Exact fixed acceptance executor required');
      const pending = await pendingFixedAcceptance(root, { registry });
      if (pending.blocked.length || !pending.pending.length) {
        result = pending;
      } else {
        const before = await inspectFixedCompletionPreview(registry.commonDir);
        const main = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim();
        const build = (members) => composeFixedAcceptance(root, { active: before.head, main, pending: members });
        if (command === 'plan') {
          result = build(pending.pending);
          assert.equal((await inspectFixedCompletionPreview(registry.commonDir)).proofDigest, before.proofDigest);
        } else {
          const { loadFixedAcceptanceHost, publishFixedAcceptance, registerFixedAcceptancePlan } =
            await import('./task-fixed-acceptance-run.mjs');
          const host = await loadFixedAcceptanceHost(registry.commonDir, policy);
          const next = pending.pending[0];
          const plan = registerFixedAcceptancePlan(registry.commonDir, next, () => build([next]));
          result = await publishFixedAcceptance(root, { plan, ...host }, { registry });
        }
      }
    } else if (command === 'ready') {
      const root = process.cwd();
      const registry = createTaskRegistry(root);
      const policy = readFixedAcceptancePolicy(registry.commonDir);
      assert.ok(policy, 'Fixed acceptance is not enabled');
      const actor = process.env.CODEX_THREAD_ID;
      const task = registry.resolve({ id });
      assert.ok(actor && [policy.executor, taskExecutor(task)].includes(actor), 'Exact acceptance executor required');
      const proof = await verifyFixedAcceptanceMember(root, id, { registry });
      const { recordToolProgress } = await import('./task-delivery-status-sync.mjs');
      const entry = recordToolProgress(
        path.join(registry.commonDir, 'task-progress', proof.board),
        proof.board,
        'fixed-acceptance:' + proof.publication + ':' + proof.development,
        fixedAcceptanceReadyFact(proof),
      );
      result = { status: entry.state, receipt: entry.receipt_id, proof };
    } else {
      throw new Error(
        'acceptance pending | acceptance plan | acceptance reconcile | acceptance ready <registered-task-id>',
      );
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
