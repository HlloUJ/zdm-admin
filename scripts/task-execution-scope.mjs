// A global pause can retain exact, explicitly authorized exceptions. Never infer
// an exception from task status, elapsed time or a missing executor observation.
export const scopedAdmissions = (state) => [
  ...(state?.scopedAdmission ? [state.scopedAdmission] : []),
  ...(state?.scopedAdmissions ?? []),
];
export const hasScopedAdmission = (state, ticket) =>
  Boolean(ticket) &&
  scopedAdmissions(state).some(
    (scope) =>
      scope.lane === ticket.lane &&
      scope.task === ticket.task &&
      scope.owner === ticket.owner &&
      scope.admission === ticket.admission,
  );
export const executionPausedFor = (state, ticket) => state?.paused === true && !hasScopedAdmission(state, ticket);
