import assert from 'node:assert/strict';

export const BATCH_TIMING_VERSION = 1;
export const milliseconds = (value) => (typeof value === 'number' ? value : Date.parse(value));
const finite = (value) => Number.isFinite(value);
export function ranges(intervals) {
  const result = [];
  for (const [start, end] of intervals
    .filter(([a, b]) => finite(a) && finite(b) && b >= a)
    .sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
export const duration = (intervals) => ranges(intervals).reduce((sum, [a, b]) => sum + b - a, 0);
export function subtract(intervals, excluded) {
  let parts = ranges(intervals);
  for (const [a, b] of ranges(excluded))
    parts = parts.flatMap(([x, y]) =>
      y <= a || x >= b
        ? [[x, y]]
        : [
            [x, Math.max(x, a)],
            [Math.min(y, b), y],
          ].filter(([s, e]) => e > s),
    );
  return parts;
}
export function newTimeline({ batch, common, anchor, worktree, authorizedAt, requestId, thread, initialTurn = null }) {
  assert.match(batch, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(finite(authorizedAt) && requestId && thread && common && anchor && worktree);
  return {
    version: BATCH_TIMING_VERSION,
    batch,
    common,
    roots: [anchor, worktree],
    authorizedAt,
    requestId,
    initialThread: thread,
    initialTurn,
    sources: [],
    turns: [],
    questions: [],
    issues: [],
    delivery: null,
  };
}
function issue(state, code) {
  if (!state.issues.includes(code)) state.issues.push(code);
}
function immutable(state, record, key, value) {
  if (record[key] != null && record[key] !== value) issue(state, 'conflicting-' + key);
  else record[key] = value;
}
// Structured question replies only; never classify natural-language authorization or retain its text.
export function replyIds(item) {
  const content =
    item.content
      ?.filter((part) => part.type === 'text' || part.type === 'Text')
      .map((part) => part.text ?? '')
      .join('') ?? '';
  const match = content.match(
    /^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/,
  );
  if (!match) return [];
  try {
    const replies = JSON.parse(match[1]);
    assert.ok(Array.isArray(replies));
    return replies.map((reply) => {
      const ids = JSON.parse(reply.questionItemId);
      assert.ok(Array.isArray(ids) && ids.length === 3 && typeof ids[1] === 'string');
      return ids[1];
    });
  } catch {
    return null;
  }
}
export function ingestNative(state, record, source) {
  const at = milliseconds(record.timestamp),
    p = record.payload ?? {};
  if (!finite(at)) {
    issue(state, 'invalid-event-time');
    return;
  }
  if (record.type !== 'event_msg') return;
  if (at < state.authorizedAt && !(p.type === 'task_started' && p.turn_id === state.initialTurn)) return;
  if (p.type === 'task_started') {
    if (state.delivery && at > state.delivery.closedAt) return;
    if (!p.turn_id) {
      issue(state, 'missing-turn-id');
      return;
    }
    let turn = state.turns.find((t) => t.thread === source.thread && t.id === p.turn_id);
    if (!turn) {
      turn = {
        thread: source.thread,
        id: p.turn_id,
        startedAt: at,
        finishedAt: null,
        projectVerified: source.contexts?.[p.turn_id] === true,
      };
      state.turns.push(turn);
    } else immutable(state, turn, 'startedAt', at);
    return;
  }
  const turn = state.turns.find((t) => t.thread === source.thread && t.id === p.turn_id);
  if (!turn) return;
  if (p.type === 'task_complete') {
    if (at < turn.startedAt) issue(state, 'negative-turn');
    immutable(state, turn, 'finishedAt', at);
  }
  if (p.type !== 'item_completed') return;
  const item = p.item ?? {};
  if (item.type === 'AgentMessage' && Array.isArray(item.questions) && item.questions.length && item.id) {
    const start = finite(p.started_at_ms) ? p.started_at_ms : at;
    const existing = state.questions.find((q) => q.id === item.id && q.thread === source.thread);
    if (existing) {
      if (existing.requestedAt !== start) issue(state, 'conflicting-question');
    } else
      state.questions.push({ id: item.id, thread: source.thread, turn: turn.id, requestedAt: start, answeredAt: null });
  }
  if (item.type === 'UserMessage' && item.id !== state.requestId) {
    const ids = replyIds(item);
    if (ids === null) issue(state, 'malformed-question-reply');
    for (const id of ids ?? []) {
      const question = state.questions.find((q) => q.id === id && q.thread === source.thread);
      if (!question) {
        issue(state, 'unmatched-question-reply');
        continue;
      }
      if (at < question.requestedAt) issue(state, 'negative-question');
      immutable(state, question, 'answeredAt', at);
    }
  }
}
export function ingestContext(state, record, source) {
  if (record.type !== 'turn_context') return;
  const p = record.payload ?? {};
  source.contexts ??= {};
  source.contexts[p.turn_id] = state.roots.includes(p.cwd);
  const turn = state.turns.find((t) => t.thread === source.thread && t.id === p.turn_id);
  if (turn) turn.projectVerified = state.roots.includes(p.cwd);
}
export function summarizeBatch(state, { now = Date.now(), completion = null } = {}) {
  assert.equal(state.version, BATCH_TIMING_VERSION);
  const delivery = state.delivery;
  const bound = state.turns.filter((t) => !delivery || t.startedAt <= delivery.closedAt);
  const closing = delivery
    ? bound
        .filter((t) => t.startedAt <= delivery.closedAt)
        .sort((a, b) => a.startedAt - b.startedAt)
        .at(-1)
    : null;
  const sealed = Boolean(delivery && closing?.finishedAt != null && closing.finishedAt >= delivery.closedAt);
  const end = sealed ? closing.finishedAt : now;
  assert.ok(end >= state.authorizedAt);
  const clip = (list) =>
    ranges(list.map(([a, b]) => [Math.max(a, state.authorizedAt), Math.min(b, end)]).filter(([a, b]) => b >= a));
  const active = clip(bound.map((t) => [t.startedAt, t.finishedAt ?? end]));
  const pauses = clip((completion?.pauses ?? []).map((p) => [p.startedAt, p.finishedAt ?? end]));
  const questions = state.questions.filter((q) => bound.some((t) => t.id === q.turn && t.thread === q.thread));
  const response = clip(questions.map((q) => [q.requestedAt, q.answeredAt ?? end]));
  const human = subtract(response, [...active, ...pauses]);
  const pauseOnly = subtract(pauses, active);
  const gap = subtract([[state.authorizedAt, end]], [...active, ...human, ...pauseOnly]);
  const problems = [...state.issues];
  if (!state.sources.length || !bound.length) problems.push('missing-bound-execution');
  if (bound.some((t) => !t.projectVerified)) problems.push('unverified-project-turn');
  if (bound.some((t) => t.finishedAt == null && t !== closing) && delivery) problems.push('unclosed-earlier-turn');
  if (delivery && !closing) problems.push('missing-closing-turn');
  if (delivery && (state.validations ?? []).some((v) => v.finishedAt == null))
    problems.push('unfinished-local-validation');
  if (sealed && questions.some((q) => q.answeredAt == null)) problems.push('unanswered-question-at-close');
  const partition = {
    executionRoundsMs: duration(active),
    approvalBlockedMs: duration(human),
    explicitPauseOutsideRoundsMs: duration(pauseOnly),
    unclassifiedBetweenRoundsMs: duration(gap),
  };
  assert.equal(
    Object.values(partition).reduce((a, b) => a + b, 0),
    end - state.authorizedAt,
    'Batch partition must equal wall time',
  );
  const ci = clip(
    (completion?.events ?? []).filter((e) => e.name === 'ci').map((e) => [e.startedAt, e.finishedAt ?? end]),
  );
  return {
    version: 1,
    timingVersion: 3,
    batch: state.batch,
    status: problems.length ? 'incomplete' : sealed ? 'completed' : delivery ? 'awaiting-turn-end' : 'snapshot',
    authorizedAt: new Date(state.authorizedAt).toISOString(),
    observedUntil: new Date(end).toISOString(),
    deliveryCompleteAt: delivery ? new Date(delivery.closedAt).toISOString() : null,
    finalReplyCompleteAt: sealed ? new Date(closing.finishedAt).toISOString() : null,
    wallMs: end - state.authorizedAt,
    ...partition,
    approvalResponseLatencyMs: duration(response),
    ciWaitMs: duration(ci),
    localValidationMs: duration(
      clip((state.validations ?? []).filter((v) => v.finishedAt != null).map((v) => [v.startedAt, v.finishedAt])),
    ),
    localFailedAttempts: (state.validations ?? []).filter((v) => v.status === 'failed').length,
    localPendingAttempts: (state.validations ?? []).filter((v) => v.finishedAt == null).length,
    localRepairMs: null,
    localRepairMeaning: 'Not explicitly recorded; a failed test does not prove a code-repair interval.',
    detailedPhaseClassification: 'separate-from-boundary-completeness',
    turnIds: bound.map((t) => ({ thread: t.thread, id: t.id })),
    issues: [...new Set(problems)],
    unknownIntervals: gap,
    meaning: sealed
      ? 'Authorization through the verified closing execution turn; CI and approval latency are overlays, never added to wall time.'
      : 'Snapshot only; an unfinished final reply has no completion timestamp.',
  };
}
export function assertTimingReady(state, { now = Date.now(), completion = null } = {}) {
  const summary = summarizeBatch(state, { now, completion });
  assert.equal(summary.issues.length, 0, 'Batch timing boundary proof incomplete: ' + summary.issues.join(', '));
  // A current open turn is expected before final reply; older open turns cannot be silently sealed.
  const open = state.turns.filter((t) => t.finishedAt == null);
  assert.ok(open.length <= 1, 'Multiple open execution turns');
  assert.equal(summary.localPendingAttempts, 0, 'Unfinished local validation timing');
  return summary;
}
