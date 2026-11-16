import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupSlot, cleanupLaunchAgentPlan } from './task-cleanup-schedule.mjs';

test('Shanghai slots cross midnight and consume the latest slot only', () => {
  for (const [now, slot] of [
    ['2026-11-16T00:59:59+08:00', '2026-11-15T05:00:00.000Z'],
    ['2026-11-16T01:00:00+08:00', '2026-11-15T17:00:00.000Z'],
    ['2026-11-16T12:59:59+08:00', '2026-11-15T17:00:00.000Z'],
    ['2026-11-16T13:00:00+08:00', '2026-11-16T05:00:00.000Z'],
    ['2026-11-19T22:00:00+08:00', '2026-11-19T05:00:00.000Z'],
  ])
    assert.equal(cleanupSlot(Date.parse(now)).scheduledAt, slot);
});
test('launchd plan directly invokes one script twice daily and never creates a chat or installs itself', () => {
  const result = cleanupLaunchAgentPlan({
    root: '/fixture/a & b',
    node: '/opt/node',
    commonDir: '/fixture/common',
    runtimeDirectory: '/fixture/common/task-cleanup/runtime/' + 'a'.repeat(40),
    hostTimezone: 'Asia/Shanghai',
  });
  assert.deepEqual(result.hours, [1, 13]);
  const runtime = '/fixture/common/task-cleanup/runtime/' + 'a'.repeat(40);
  assert.deepEqual(result.command, ['/opt/node', runtime + '/scripts/task-cleanup-scheduled-cli.mjs', runtime]);
  assert.match(result.plist, /a &amp; b/);
  assert.match(result.plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(result.plist, /<key>StandardErrorPath<\/key><string>\/dev\/null<\/string>/);
  assert.equal((result.plist.match(/<key>Minute<\/key><integer>0<\/integer>/g) ?? []).length, 2);
  assert.equal(result.installed, false);
  assert.ok(result.activationRequirements.length);
  assert.throws(
    () =>
      cleanupLaunchAgentPlan({
        root: '/fixture',
        node: '/opt/node',
        commonDir: '/fixture/common',
        hostTimezone: 'UTC',
      }),
    /timezone/,
  );
});
