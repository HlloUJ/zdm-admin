import assert from 'node:assert/strict';
import path from 'node:path';

export const CLEANUP_TIMEZONE = 'Asia/Shanghai';
export const CLEANUP_HOURS = [1, 13];

// No backlog replay: a wake-up may consume at most the latest Shanghai slot.
export function cleanupSlot(now = Date.now()) {
  assert.ok(Number.isFinite(now));
  const shifted = new Date(now + 8 * 3600000),
    hour = shifted.getUTCHours();
  shifted.setUTCHours(hour >= 13 ? 13 : hour >= 1 ? 1 : 13, 0, 0, 0);
  if (hour < 1) shifted.setUTCDate(shifted.getUTCDate() - 1);
  return { timezone: CLEANUP_TIMEZONE, scheduledAt: new Date(shifted.getTime() - 8 * 3600000).toISOString() };
}

const xml = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c],
  );
export function cleanupLaunchAgentPlan({
  root,
  node,
  commonDir,
  runtimeDirectory,
  gitSocksPort,
  scopeOnly = false,
  hostTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
}) {
  // launchd calendar rules use the host timezone, not the child's TZ environment.
  assert.equal(
    hostTimezone,
    CLEANUP_TIMEZONE,
    'Host timezone must be Asia/Shanghai; do not silently shift calendar execution',
  );
  for (const value of [root, node, commonDir])
    assert.ok(typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value);
  assert.match(path.basename(runtimeDirectory ?? ''), /^[a-f0-9]{40}$/);
  assert.equal(runtimeDirectory, path.join(commonDir, 'task-cleanup/runtime', path.basename(runtimeDirectory)));
  const command = [node, path.join(runtimeDirectory, 'scripts/task-cleanup-scheduled-cli.mjs'), runtimeDirectory];
  if (scopeOnly) command.push('--exact-scope');
  const environment = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin' };
  if (gitSocksPort !== undefined) {
    assert.ok(Number.isInteger(gitSocksPort) && gitSocksPort > 0 && gitSocksPort <= 65535, 'Invalid local SOCKS port');
    environment.GIT_SSH_COMMAND =
      "ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=yes -o ProxyCommand='/usr/bin/nc -X 5 -x 127.0.0.1:" +
      gitSocksPort +
      " %h %p'";
  }
  const envPlist = Object.entries(environment)
    .map(([key, value]) => '<key>' + xml(key) + '</key><string>' + xml(value) + '</string>')
    .join('');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.zdm.admin.manifest-cleanup</string>
<key>ProgramArguments</key><array>${command.map((v) => '<string>' + xml(v) + '</string>').join('')}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>StartCalendarInterval</key><array>${CLEANUP_HOURS.map((hour) => '<dict><key>Hour</key><integer>' + hour + '</integer><key>Minute</key><integer>0</integer></dict>').join('')}</array>
<key>RunAtLoad</key><true/>
<key>EnvironmentVariables</key><dict>${envPlist}</dict>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>\n`;
  return {
    label: 'com.zdm.admin.manifest-cleanup',
    timezone: CLEANUP_TIMEZONE,
    hours: CLEANUP_HOURS,
    command,
    journal: path.join(commonDir, 'task-cleanup/scheduler-state.json'),
    startupObservation: 'launchctl LastExitStatus; a process that cannot start cannot write its own journal',
    plist,
    installed: false,
    activationRequirements: [
      'Published trusted main source and exact Python helper available',
      '987 producer integrated and proven on a real closed manifest',
      'Explicit production budgets, metadata policy and scheduler history limits',
      'External launchd startup/exit-status observation; no process can self-report failure to start',
      'Proven notification adapter and real 01:00/13:00 cycle evidence',
    ],
  };
}
