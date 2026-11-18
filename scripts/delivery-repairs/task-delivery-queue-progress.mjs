import { isDeepStrictEqual } from 'node:util';
import { captureQueueProgress } from '../task-delivery-status-sync.mjs';

function projectPause(state, ticket) {
  if (!state?.paused || ticket?.lane !== 'delivery' || !['queued', 'blocked'].includes(ticket.status)) return state;
  const fence = state.events.findLast(({ action }) => action === 'initialize' || action === 'pause-all')?.request;
  if (!Number.isSafeInteger(fence?.sequence) || !fence.authorId || fence.authorId !== ticket.request.authorId)
    return state;

  const authority = state.events.findLast((event) => {
    if (event.task !== ticket.task) return false;
    if (event.action === 'delivery-phase-enrolled') {
      return (
        ticket.status === 'queued' &&
        ticket.admission === null &&
        ticket.phaseOrigin?.phaseId === event.phaseId &&
        ticket.phaseOrigin?.authorityId === event.authorityId &&
        event.owner === ticket.owner &&
        event.order === ticket.order
      );
    }
    if (event.action !== 'preparation-finished') return false;
    const decision = state.dynamicDecisions?.find(({ id }) => id === event.decisionId);
    return (
      decision?.status === 'finished' &&
      decision.input.phase === 'preparation' &&
      isDeepStrictEqual(decision.ticketBefore, ticket)
    );
  })?.request;

  if (
    authority?.authorId === fence.authorId &&
    Number.isSafeInteger(authority.sequence) &&
    authority.sequence > fence.sequence
  )
    return { ...state, paused: false };
  return state;
}

// These views affect receipts only. The persisted queue and its admissions stay authoritative.
export function captureDeliveryQueueProgress(commonDir, state, previous) {
  for (const ticket of state.tickets) {
    const before = previous?.tickets.find((item) => item.task === ticket.task && item.lane === ticket.lane);
    captureQueueProgress(
      commonDir,
      { ...projectPause(state, ticket), tickets: [ticket] },
      projectPause(previous, before),
    );
  }
}
