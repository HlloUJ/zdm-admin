import assert from 'node:assert/strict';

export const PREVIEW_OWNER_FIELDS = ['worktree', 'childPid', 'servicePid', 'selectionRevision'];
export function previewOwner(status) {
  assert.equal(status?.type, 'zdm-task-preview-service', 'Unknown preview service');
  assert.ok(Number.isSafeInteger(status.selectionRevision), 'Preview service lacks atomic ownership protocol');
  return Object.fromEntries(PREVIEW_OWNER_FIELDS.map((key) => [key, status[key]]));
}
export function assertPreviewOwner(expected, actual) {
  assert.ok(expected, 'Exact preview ownership required');
  for (const field of PREVIEW_OWNER_FIELDS)
    assert.equal(expected[field], actual[field], 'Preview owner changed: ' + field);
}

// Fixed port 5176 cannot host both frontends. Validate before the interruption,
// keep the old selection until the stop succeeds, and restore it on start failure.
// The caller holds the preview resource lease for this entire transaction.
export async function transitionSelectedPreview({ expected, target, taskArgs, control, forceTransition = false }) {
  assertPreviewOwner(expected, control.status());
  const prepared = await control.prepare(target, taskArgs);
  assertPreviewOwner(expected, control.status());
  await control.validate(prepared);
  assertPreviewOwner(expected, control.status());
  const previous = control.selection();
  if (
    !forceTransition &&
    previous.worktree === target.worktree &&
    JSON.stringify(previous.taskArgs) === JSON.stringify(taskArgs)
  ) {
    const status = await control.launch();
    return { status, interruption: false, reused: true };
  }
  try {
    await control.stop(previous);
  } catch (error) {
    // The original selection remains authoritative even when the child/backend
    // stopped only partially. Do not overwrite ownership or release its data.
    control.error(error);
    throw error;
  }
  let selected = false;
  try {
    await control.select(target.worktree, taskArgs);
    selected = true;
    await control.validate(prepared);
    const status = await control.launch();
    return { status, interruption: true, reused: false };
  } catch (error) {
    control.cancelRestart();
    try {
      if (selected) await control.stop({ worktree: target.worktree, taskArgs });
      if (control.restore) await control.restore(previous);
      else await control.select(previous.worktree, previous.taskArgs);
      if (previous.worktree && previous.canRestore !== false) await control.launch();
    } catch (recoveryError) {
      control.error(recoveryError);
      throw new AggregateError(
        [error, recoveryError],
        'Target failed and previous preview recovery failed; retain ownership and data',
        { cause: recoveryError },
      );
    }
    throw new Error(
      (previous.worktree && previous.canRestore !== false
        ? 'Target failed; previous preview was restored: '
        : 'Target failed; ownership and data retained without claiming a healthy previous runtime: ') + error.message,
      { cause: error },
    );
  }
}
