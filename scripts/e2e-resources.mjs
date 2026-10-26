import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
export function parseProcessStat(text) {
  const end = text.lastIndexOf(')'),
    start = text.indexOf('(');
  const values = text
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  return {
    pid: Number(text.slice(0, start).trim()),
    name: text.slice(start + 1, end),
    ppid: Number(values[1]),
    ticks: Number(values[11]) + Number(values[12]),
    start: values[19],
    rssPages: Number(values[21]),
  };
}
export function processRoles(processes, root, servers) {
  const byId = new Map(processes.map((p) => [p.pid, p]));
  const descends = (pid, ancestor) => {
    const seen = new Set();
    while (pid && !seen.has(pid)) {
      if (pid === ancestor) return true;
      seen.add(pid);
      pid = byId.get(pid)?.ppid;
    }
    return false;
  };
  return processes
    .filter((p) => p.pid !== root && descends(p.pid, root))
    .map((p) => ({
      ...p,
      role: servers.some((pid) => descends(p.pid, pid))
        ? 'server'
        : /chrome|chromium/i.test(p.name)
          ? 'browser'
          : 'worker',
    }));
}
export function createResourceCollector({
  root = process.pid,
  read = () => {
    const processes = readdirSync('/proc')
      .filter((name) => /^\d+$/.test(name))
      .flatMap((name) => {
        try {
          return [parseProcessStat(readFileSync(`/proc/${name}/stat`, 'utf8'))];
        } catch {
          return [];
        }
      });
    const servers = ['app', 'dev'].flatMap((role) => {
      try {
        return [JSON.parse(readFileSync(path.join(process.cwd(), `.task-runtime/e2e-${role}-process.json`))).pid];
      } catch {
        return [];
      }
    });
    return processRoles(processes, root, servers);
  },
  ticksPerSecond = Number(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout) || 100,
  pageSize = Number(spawnSync('getconf', ['PAGESIZE'], { encoding: 'utf8' }).stdout) || 4096,
} = {}) {
  let previous = new Map(),
    samples = 0,
    available = false;
  const totals = Object.fromEntries(
    ['server', 'browser', 'worker'].map((role) => [role, { cpuMs: 0, peakRssBytes: 0 }]),
  );
  const sample = () => {
    try {
      const rows = read(),
        rss = { server: 0, browser: 0, worker: 0 },
        next = new Map();
      for (const p of rows) {
        const key = `${p.pid}:${p.start}`;
        const old = previous.get(key);
        if (old !== undefined) totals[p.role].cpuMs += (Math.max(0, p.ticks - old) * 1000) / ticksPerSecond;
        rss[p.role] += p.rssPages * pageSize;
        next.set(key, p.ticks);
      }
      for (const role of Object.keys(rss)) totals[role].peakRssBytes = Math.max(totals[role].peakRssBytes, rss[role]);
      previous = next;
      samples++;
      available = true;
    } catch {
      /* Optional Linux observation; never changes gate or starts a service. */
    }
  };
  sample();
  const timer = setInterval(sample, 2000);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
      sample();
      return {
        available,
        samples,
        roles: totals,
        limitations:
          'Sampled descendants only; short-lived processes may be missed. RSS is a sum and may count shared pages. No arguments, environment values, URLs or page data are collected.',
      };
    },
  };
}
