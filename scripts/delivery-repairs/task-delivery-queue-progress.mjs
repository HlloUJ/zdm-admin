import { isDeepStrictEqual } from 'node:util';
import { captureQueueProgress } from '../task-delivery-status-sync.mjs';

function deliveryWaitRequest(state, ticket) {
  if (ticket.lane !== 'delivery' || !['queued', 'blocked'].includes(ticket.status)) return null;
  const event = state.events?.findLast(
    (item) =>
      item.task === ticket.task &&
      (['delivery-phase-enrolled', 'preparation-finished'].includes(item.action) ||
        (item.action === 'dispatch-applied' && item.lane === ticket.lane)),
  );
  if (event?.action === 'delivery-phase-enrolled') {
    const origin = ticket.phaseOrigin;
    if (
      ticket.status !== 'queued' ||
      ticket.admission !== null ||
      !origin?.phaseId ||
      !origin.authorityId ||
      event.phaseId !== origin.phaseId ||
      event.authorityId !== origin.authorityId ||
      event.owner !== ticket.owner ||
      event.order !== ticket.order ||
      event.developmentEvidenceDigest !== origin.developmentEvidenceDigest
    )
      return null;
    const grant = state.dynamicAuthorities?.find((item) => item.id === origin.authorityId);
    return grant && isDeepStrictEqual(event.request, grant.request) ? grant.request : null;
  }
  if (event?.action !== 'preparation-finished') return null;
  const decision = state.dynamicDecisions?.find((item) => item.id === event.decisionId);
  if (
    decision?.status !== 'finished' ||
    !decision.prepared ||
    decision.input.phase !== 'preparation' ||
    decision.input.lane !== ticket.lane ||
    decision.input.task !== ticket.task ||
    decision.input.owner !== ticket.owner ||
    !isDeepStrictEqual(decision.ticketBefore, ticket)
  )
    return null;
  const grant = state.dynamicAuthorities?.find((item) => item.id === decision.input.authorityId);
  return grant && isDeepStrictEqual(event.request, grant.request) ? grant.request : null;
}

// Use the verified delivery request only for progress projection.
export function captureDeliveryQueueProgress(commonDir, state, previous) {
  captureQueueProgress(commonDir, state, previous, deliveryWaitRequest);
}
