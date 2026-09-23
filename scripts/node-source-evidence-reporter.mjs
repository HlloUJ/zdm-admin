import { writeFileSync } from 'node:fs';

// Consume the Node runner's structured event stream, not source text or printed TAP.
export default async function* evidenceReporter(source) {
  const events = [];
  for await (const event of source) {
    if (['test:enqueue', 'test:pass', 'test:fail', 'test:summary'].includes(event.type)) events.push(event);
  }
  writeFileSync(
    process.env.FRONTEND_TEST_REPORT,
    JSON.stringify(
      {
        schemaVersion: 1,
        runId: process.env.FRONTEND_TEST_RUN_ID,
        events,
      },
      null,
      2,
    ) + '\n',
  );
  yield '';
}
