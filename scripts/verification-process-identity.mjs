import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

export function inspectProcess(pid, exec = execFileSync) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  try {
    const text = exec('/bin/ps', ['-p', String(pid), '-o', 'pid=,pgid=,lstart='], { encoding: 'utf8' }).trim();
    if (!text) return null;
    const match = /^(\d+)\s+(\d+)\s+(.+)$/.exec(text);
    assert.ok(match, 'Cannot parse process identity');
    return { pid: Number(match[1]), pgid: Number(match[2]), startTime: match[3] };
  } catch (error) {
    if (error.status === 1 && !String(error.stdout ?? '').trim() && !String(error.stderr ?? '').trim()) return null;
    throw error;
  }
}
