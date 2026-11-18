import { planScheduledReplay } from './task-progress-replay.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordToolProgress } from './task-delivery-status-sync.mjs';
import { createProgressOutbox } from './task-progress-outbox.mjs';

// Authenticated owner host consumes these envelopes; no credentials, new server or direct Site URL.
export function deliverySyncCommand(command, input) {
  if (command === 'replay-plan') return planScheduledReplay(input);
  const outbox = createProgressOutbox(input.directory);
  if (command === 'replay-error') {
    assert.ok(outbox.read().pending.every((entry) => entry.receipt.task_id === input.task));
    outbox.fail(input.receipt_id, input.code);
    return planScheduledReplay({ directory: input.directory, task: input.task });
  }
  if (command === 'record') return recordToolProgress(input.directory, input.task, input.source_key, input.receipt);
  if (command === 'pending') return outbox.read().pending;
  if (command === 'prepare') return outbox.prepare(input.receipt_id, input.revision);
  if (command === 'acknowledge') return outbox.acknowledge(input.receipt_id, input.readback);
  assert.fail('Use replay-plan, replay-error, record, pending, prepare or acknowledge');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(
    process.argv.length,
    4,
    'Usage: node scripts/task-delivery-status-sync-cli.mjs <replay-plan|replay-error|record|pending|prepare|acknowledge> input.json',
  );
  console.log(
    JSON.stringify(deliverySyncCommand(process.argv[2], JSON.parse(readFileSync(process.argv[3], 'utf8'))), null, 2),
  );
}
