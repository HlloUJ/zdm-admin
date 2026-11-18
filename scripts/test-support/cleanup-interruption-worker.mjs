// Isolated test worker only. No CLI is exposed by the production scheduler.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runScheduledCleanup } from '../task-cleanup-scheduled-cli.mjs';
import { createCleanupQueue } from '../task-cleanup-queue.mjs';
import { runCompletionProcess } from '../completion-process.mjs';
const config = JSON.parse(readFileSync(process.argv[2]));
const python = `import io,json,os,sys,time
request=json.load(sys.stdin)
namespace={'__name__':'isolated_partial_deletion'}
with open(request['helper']) as source: exec(compile(source.read(),request['helper'],'exec'),namespace)
original=os.unlink
paused=False
def unlink(name,*,dir_fd=None):
 global paused
 original(name,dir_fd=dir_fd)
 if not paused:
  paused=True
  with open(request['marker'],'x') as marker: json.dump({'pid':os.getpid(),'removed':name},marker)
  while True: time.sleep(0.02)
os.unlink=unlink
sys.stdin=io.StringIO(json.dumps(request['deletion']))
namespace['main']()
`;
await runScheduledCleanup(config.root, {
  now: config.now,
  hostTimezone: 'Asia/Shanghai',
  verifyRuntime: () => ({ root: config.root, commonDir: config.common, sourceHead: config.sourceHead }),
  notify: async () => ({ status: 'idle' }),
  runCleanup: () =>
    createCleanupQueue(config.common).run({
      apply: true,
      verify: async () => ({ ready: true }),
      unreferenced: async () => {},
      remove: (directory, entries) => {
        const result = runCompletionProcess('python3', ['-I', '-c', python], {
          input: JSON.stringify({
            helper: fileURLToPath(new URL('../task-cleanup-delete.py', import.meta.url)),
            marker: config.marker,
            deletion: { path: directory, entries },
          }),
          encoding: 'utf8',
        });
        if (result.status !== 0) throw Error('Isolated deletion worker ended before completion');
        return JSON.parse(result.stdout);
      },
    }),
});
