import { createHash, createHmac } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const file = path.join(common, 'preview-environment', 'environment.json');
if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('长期预览登记不是安全文件');
const registration = JSON.parse(readFileSync(file, 'utf8'));
const profile = registration.profile;
if (
  registration.version !== 1 ||
  registration.repository !== common ||
  !profile ||
  !/^zdm_task_[a-zA-Z0-9_]+$/.test(profile.database) ||
  typeof profile.password !== 'string' ||
  profile.password.length < 12
) {
  throw new Error('不能证明独立长期预览数据归属，停止启动记录服务');
}
const scope = createHash('sha256').update(profile.database).digest('hex').slice(0, 16);
const name = `zdm-store-exit-ledger-${scope}`;
const volume = `${name}-data`;
const context = path.join(root, 'infrastructure', 'store-exit-ledger');
const sourceHash = createHash('sha256')
  .update(readFileSync(path.join(context, 'server.mjs')))
  .update(readFileSync(path.join(context, 'Dockerfile')))
  .digest('hex');
const image = `zdm-store-exit-ledger:${sourceHash.slice(0, 16)}`;
const plan = {
  database: profile.database,
  container: name,
  volume,
  image,
  network: 'zdm-admin_default',
  publishedPorts: [],
  independentOf: ['SQL备份', '媒体备份', 'Git工作区'],
  sourceHash,
};
if (!process.argv.includes('--start')) {
  process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
  process.exit(0);
}
const run = (args) => {
  const r = spawnSync('docker', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('独立记录服务操作失败，数据卷和现有容器保持保留；请检查Docker状态');
  return r.stdout.trim();
};
const probe = spawnSync('docker', ['container', 'inspect', name], { encoding: 'utf8' });
let create = probe.status !== 0;
if (!create) {
  const container = JSON.parse(probe.stdout)[0];
  if (
    container.Config?.Labels?.['com.zdm.ledger.scope'] !== profile.database ||
    container.Config?.Labels?.['com.zdm.retained-data'] !== 'store-exit-ledger' ||
    !container.Mounts?.some((m) => m.Name === volume && m.Destination === '/data/store-exit-ledger')
  ) {
    throw new Error('记录服务作用域或持久挂载不一致；保留现场，不自动替换');
  }
  if (container.Config?.Labels?.['com.zdm.ledger.source'] !== sourceHash) {
    if (!process.argv.includes('--upgrade'))
      throw new Error('代码版本不同；需使用明确的--upgrade保留旧容器及原数据卷后升级');
    const oldSource = container.Config?.Labels?.['com.zdm.ledger.source'];
    if (!/^[a-f0-9]{64}$/.test(oldSource ?? '')) throw new Error('旧服务代码归属不明，停止升级');
    const preserved = `${name}-preserved-${oldSource.slice(0, 12)}`;
    const old = spawnSync('docker', ['container', 'inspect', preserved], { encoding: 'utf8' });
    if (old.status === 0) throw new Error('保留载体已存在，不覆盖已有容器');
    run(['build', '--tag', image, context]);
    if (container.State?.Running) run(['stop', name]);
    run(['rename', name, preserved]);
    create = true;
  } else if (!container.State?.Running) run(['start', name]);
}
if (create) {
  // No destructive teardown, credential logging, global DB changes or shared volume reuse.
  run(['build', '--tag', image, context]);
  run(['volume', 'create', '--label', 'com.zdm.retained-data=store-exit-ledger', volume]);
  const token = createHmac('sha256', profile.password).update(`zdm-store-exit:${profile.database}`).digest('hex');
  run([
    'run',
    '--detach',
    '--name',
    name,
    '--restart',
    'unless-stopped',
    '--network',
    'zdm-admin_default',
    '--network-alias',
    name,
    '--mount',
    `type=volume,source=${volume},target=/data/store-exit-ledger`,
    '--label',
    'com.zdm.retained-data=store-exit-ledger',
    '--label',
    `com.zdm.ledger.scope=${profile.database}`,
    '--label',
    `com.zdm.ledger.source=${sourceHash}`,
    '--env',
    `ZDM_LEDGER_NAMESPACE=${profile.database}`,
    '--env',
    `ZDM_LEDGER_AUTH_TOKEN=${token}`,
    image,
  ]);
}
process.stdout.write(JSON.stringify({ ...plan, started: true, readyVerified: false }) + '\n');
