import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry } from './task-registry.mjs';
import { withIntegrationResource } from './integration-resource.mjs';

const MYSQL = 'zdm-platform-mysql';
const SHARED_DATABASE = 'zdm_admin';
const SHARED_MEDIA = 'zdm-admin_zdm_craft_images';
const COPY_IMAGE = 'maven:3.9.9-eclipse-temurin-21';
const SQL_NAME = /^[a-z][a-z0-9_]{1,63}$/;
export function taskDataNames(root, project) {
  const hash = createHash('sha256')
    .update(path.resolve(root) + ':' + project)
    .digest('hex')
    .slice(0, 16);
  return { database: `zdm_task_${hash}`, username: `zdm_t_${hash}`, mediaVolume: `zdm-task-media-${hash}` };
}
export function taskDataFile(root) {
  return path.join(root, '.task-runtime', 'data-environment.json');
}
export function validateTaskData(value, root, project) {
  const expected = taskDataNames(root, project);
  if (
    value?.version !== 1 ||
    value.status !== 'ready' ||
    value.workspaceRoot !== path.resolve(root) ||
    value.project !== project ||
    !Object.entries(expected).every(([key, item]) => value[key] === item) ||
    !/^[a-f0-9]{48}$/.test(value.password ?? '') ||
    !value.backupFile
  ) {
    throw new Error('任务数据环境记录不可核验，保留现场，不自动覆盖');
  }
  return value;
}
function readLegacyTaskData(root, project) {
  const file = taskDataFile(root);
  if (!existsSync(file)) return null;
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('任务数据记录不是安全文件');
  return validateTaskData(JSON.parse(readFileSync(file, 'utf8')), root, project);
}

// The Git common directory survives task-worktree and branch cleanup.
function dataLocation(root) {
  const result = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('无法定位仓库长期预览数据登记');
  const common = realpathSync(path.resolve(root, result.stdout.trim()));
  const registry = createTaskRegistry(root);
  const matches = registry.list().filter((task) => task.worktree === realpathSync(root));
  if (matches.length > 1) throw new Error('任务数据归属不唯一');
  const task = matches[0];
  const branch = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' });
  if (branch.status !== 0) throw new Error('无法证明数据使用方的分支');
  if (branch.stdout.trim() === 'codex/preview-current') {
    const directory = path.join(common, 'preview-environment/published');
    for (const entry of [path.dirname(directory), directory])
      if (existsSync(entry) && (lstatSync(entry).isSymbolicLink() || !lstatSync(entry).isDirectory()))
        throw new Error('已交付预览数据目录不安全');
    return { common, task: null, registeredTask: null, directory, project: 'published-preview' };
  }
  const scope = task?.resources?.dataScope ?? 'persistent-preview';
  if (!['persistent-preview', 'isolated-task'].includes(scope)) throw new Error('未知任务数据范围');
  const directory =
    scope === 'isolated-task'
      ? path.join(common, 'task-environments', task.id)
      : path.join(common, 'preview-environment');
  for (const entry of [path.dirname(directory), directory])
    if (existsSync(entry) && (lstatSync(entry).isSymbolicLink() || !lstatSync(entry).isDirectory()))
      throw new Error('数据登记目录不是安全目录');
  return {
    common,
    task: scope === 'isolated-task' ? task.id : null,
    registeredTask: task ?? null,
    directory,
    project: scope === 'isolated-task' ? 'task-' + task.id : 'persistent-preview',
  };
}
export function previewDataRoot(root) {
  return dataLocation(root).directory;
}
export function previewDataFile(root) {
  return path.join(previewDataRoot(root), 'environment.json');
}
export function readTaskData(root) {
  const file = previewDataFile(root);
  if (!existsSync(file)) return null;
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('长期预览登记不是安全文件');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  const location = dataLocation(root);
  if (record.version !== 1 || record.repository !== location.common || (location.task && record.task !== location.task))
    throw new Error('长期预览登记不属于当前仓库');
  const profile = record.profile;
  return validateTaskData(
    profile,
    location.task || location.project === 'published-preview' ? location.directory : profile.workspaceRoot,
    location.task || location.project === 'published-preview' ? location.project : profile.project,
  );
}
export function adoptPreviewData(root, sourceFile, execute = command) {
  const destination = previewDataFile(root);
  if (existsSync(destination)) throw new Error('长期预览已有登记，不自动替换');
  const stat = lstatSync(sourceFile);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('原任务数据登记不是安全文件');
  const profile = JSON.parse(readFileSync(sourceFile, 'utf8'));
  const location = dataLocation(root);
  validateTaskData(
    profile,
    location.task || location.project === 'published-preview' ? location.directory : profile.workspaceRoot,
    location.task || location.project === 'published-preview' ? location.project : profile.project,
  );
  taskDataComposeEnv(profile);
  if (
    rootSql(`SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${profile.database}';`, execute) !==
    '1'
  )
    throw new Error('原预览数据库不存在');
  execute(['volume', 'inspect', profile.mediaVolume]);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(
    destination,
    JSON.stringify({
      version: 1,
      repository: dataLocation(root).common,
      ...(dataLocation(root).task ? { task: dataLocation(root).task } : {}),
      profile,
    }) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  return profile;
}
export function requireTaskData(root) {
  const location = dataLocation(root);
  if (location.registeredTask?.recovery?.runtimeBlocked) throw new Error('历史恢复候选尚未核验，禁止启动或迁移数据');
  if (location.registeredTask && !location.task && location.registeredTask.resources.persistentPreviewOwner !== true)
    throw new Error('尚未证明跨任务数据兼容；请先准备当前任务的独立数据，不使用其他未完成任务的库');
  const data = readTaskData(root);
  if (!data) throw new Error('预览数据登记缺失；启动不得自动创建或重建，请先完成明确的数据准备');
  return data;
}
export async function ensureTaskData(options, dependencies = {}) {
  requireTaskData(options.root);
  return provisionPreviewData(options, dependencies);
}
// Explicit provisioning only. Normal launch calls ensureTaskData and cannot enter
// the initializer when a retained schema or registration is missing.
export async function provisionPreviewData({ root, project, integrationRoot }, dependencies = {}) {
  const location = dataLocation(root);
  if (location.registeredTask?.recovery?.runtimeBlocked) throw new Error('历史恢复候选尚未核验，禁止启动或迁移数据');
  if (readTaskData(root)) return provisionPreviewDataLocked({ root, project, integrationRoot }, dependencies);
  return withIntegrationResource(root, location.registeredTask?.id ?? project, () =>
    withIntegrationResource(integrationRoot, location.registeredTask?.id ?? project, () =>
      provisionPreviewDataLocked({ root, project, integrationRoot }, dependencies),
    ),
  );
}
async function provisionPreviewDataLocked({ root, project, integrationRoot }, dependencies) {
  const execute = dependencies.execute ?? command;
  const existing = readTaskData(root);
  if (existsSync(path.join(previewDataRoot(root), 'update.json')))
    throw new Error('长期预览数据更新保护尚未完成，保留备份和现场');
  if (existing) {
    taskDataComposeEnv(existing);
    assertPreviewWriter(existing, project, execute);
    if (
      rootSql(`SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${existing.database}';`, execute) !==
      '1'
    )
      throw new Error('长期预览库丢失，不自动重建');
    execute(['volume', 'inspect', existing.mediaVolume]);
    return existing;
  }
  if (existsSync(taskDataFile(root))) throw new Error('检测到旧任务数据，请先显式登记为长期预览，不能覆盖');
  const dataRoot = previewDataRoot(root);
  mkdirSync(dataRoot, { recursive: true });
  const lock = path.join(dataRoot, 'initializing');
  mkdirSync(lock); // An exclusive initializer; failure retains the protection and backup.
  const profile = await ensureLegacyTaskData(
    {
      root: dataRoot,
      project: dataLocation(root).project,
      integrationRoot,
    },
    dependencies,
  );
  adoptPreviewData(root, taskDataFile(dataRoot), execute);
  rmdirSync(lock);
  return profile;
}

export function taskDataComposeEnv(value) {
  if (
    !SQL_NAME.test(value.database) ||
    !SQL_NAME.test(value.username) ||
    value.database === SHARED_DATABASE ||
    value.mediaVolume === SHARED_MEDIA
  )
    throw new Error('任务数据环境不能指向集成资产');
  return {
    ZDM_TASK_DB_NAME: value.database,
    ZDM_TASK_DB_USERNAME: value.username,
    ZDM_TASK_DB_PASSWORD: value.password,
    ZDM_TASK_MEDIA_VOLUME: value.mediaVolume,
  };
}
function command(args, { input, cwd } = {}) {
  const result = spawnSync('docker', args, { cwd, input, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('任务数据操作失败，保留数据和备份，请检查数据库/容器状态');
  return result.stdout.trim();
}
export function rootSql(sql, execute = command) {
  return execute(
    [
      'exec',
      '-i',
      MYSQL,
      'sh',
      '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --raw --skip-column-names',
    ],
    { input: sql },
  );
}
export function snapshotDatabase(root, directory, execute = command, database = SHARED_DATABASE) {
  if (!SQL_NAME.test(database)) throw new Error('数据库名称无效');
  mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(directory, `${database}-${stamp}.sql.gz`);
  const sql = execute(
    [
      'exec',
      MYSQL,
      'sh',
      '-c',
      `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --no-tablespaces --routines --triggers --hex-blob --set-gtid-purged=OFF ${database}`,
    ],
    { cwd: root },
  );
  const compressed = gzipSync(sql);
  if (gunzipSync(compressed).toString() !== sql) throw new Error('数据库快照校验失败');
  writeFileSync(file, compressed, { mode: 0o600, flag: 'wx' });
  return { file, sql };
}
function tableCounts(database, execute) {
  if (!SQL_NAME.test(database)) throw new Error('数据库名称无效');
  const tables = rootSql(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME;`,
    execute,
  )
    .split(/\r?\n/)
    .filter(Boolean);
  return Object.fromEntries(
    tables.map((table) => {
      if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error('表名不可核验');
      return [table, rootSql(`SELECT COUNT(*) FROM \`${database}\`.\`${table}\`;`, execute)];
    }),
  );
}
export function verifyDataCopy(source, target) {
  if (JSON.stringify(source) !== JSON.stringify(target)) throw new Error('任务库表及行数不一致，保留现场');
}
async function ensureLegacyTaskData(
  { root, project, integrationRoot },
  {
    execute = command,
    volumeExists = (name) => spawnSync('docker', ['volume', 'inspect', name], { stdio: 'ignore' }).status === 0,
  } = {},
) {
  if (!integrationRoot || !/^[a-zA-Z0-9_-]+$/.test(project)) throw new Error('任务数据初始化参数不可核验');
  const existing = readLegacyTaskData(root, project);
  if (existing) {
    if (
      rootSql(`SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${existing.database}';`, execute) !==
      '1'
    )
      throw new Error('任务库丢失，不自动重建');
    execute(['volume', 'inspect', existing.mediaVolume]);
    return existing;
  }
  const names = taskDataNames(root, project);
  if (existsSync(path.join(integrationRoot, 'backups/task-preview/active-database-task.json'))) {
    throw new Error('仍有旧共享库任务保护锁，请先通过已发布启动器暂停旧任务，再切换隔离环境');
  }
  if (
    rootSql(`SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${names.database}';`, execute) !== '0'
  )
    throw new Error('目标任务库已存在且未登记，不接管');
  if (volumeExists(names.mediaVolume)) throw new Error('目标附件卷已存在且未登记，不接管');
  if (rootSql(`SELECT COUNT(*) FROM mysql.user WHERE user='${names.username}';`, execute) !== '0')
    throw new Error('目标数据库账号已存在且未登记，不接管');
  if (execute(['ps', '--filter', 'label=com.zdm.task.database=integration', '--format', '{{.ID}}']))
    throw new Error('仍有旧共享数据库任务后端运行，不能复制');
  const data = {
    version: 1,
    status: 'initializing',
    workspaceRoot: path.resolve(root),
    project,
    ...names,
    password: randomBytes(24).toString('hex'),
    createdAt: new Date().toISOString(),
    backupFile: null,
  };
  const file = taskDataFile(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data) + '\n', { flag: 'wx', mode: 0o600 });
  const sourceLock = path.join(integrationRoot, 'backups/task-preview/active-database-task.json');
  mkdirSync(path.dirname(sourceLock), { recursive: true });
  const lock = {
    type: 'zdm-integration-snapshot-lock',
    workspaceRoot: path.resolve(root),
    project,
    createdAt: data.createdAt,
  };
  writeFileSync(sourceLock, JSON.stringify(lock) + '\n', { flag: 'wx', mode: 0o600 });
  const running =
    execute(['ps', '-a', '--filter', 'name=^zdm-platform-backend$', '--format', '{{.State}}']) === 'running';
  try {
    if (running) execute(['stop', 'zdm-platform-backend']);
    const snapshot = snapshotDatabase(root, path.join(integrationRoot, 'backups/task-data', project), execute);
    data.backupFile = snapshot.file;
    writeFileSync(file, JSON.stringify(data) + '\n', { mode: 0o600 });
    const counts = tableCounts(SHARED_DATABASE, execute);
    const charset = rootSql(
      "SELECT CONCAT(DEFAULT_CHARACTER_SET_NAME,' ',DEFAULT_COLLATION_NAME) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='zdm_admin';",
      execute,
    ).split(' ');
    if (charset.length !== 2 || charset.some((value) => !/^[a-z0-9_]+$/.test(value)))
      throw new Error('集成库字符集不可核验');
    rootSql(
      `CREATE DATABASE \`${names.database}\` CHARACTER SET ${charset[0]} COLLATE ${charset[1]};
CREATE USER '${names.username}'@'%' IDENTIFIED BY '${data.password}';
GRANT ALL PRIVILEGES ON \`${names.database}\`.* TO '${names.username}'@'%';`,
      execute,
    );
    execute(['exec', '-i', MYSQL, 'sh', '-c', `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot ${names.database}`], {
      input: snapshot.sql,
    });
    verifyDataCopy(counts, tableCounts(names.database, execute));
    const history = rootSql(
      `SELECT version,script,checksum,success FROM \`${SHARED_DATABASE}\`.flyway_schema_history ORDER BY installed_rank;`,
      execute,
    );
    if (
      history !==
      rootSql(
        `SELECT version,script,checksum,success FROM \`${names.database}\`.flyway_schema_history ORDER BY installed_rank;`,
        execute,
      )
    )
      throw new Error('迁移历史复制不一致');
    execute(['volume', 'create', '--label', `com.zdm.task.data=${project}`, names.mediaVolume]);
    const volumes = ['-v', `${SHARED_MEDIA}:/source:ro`, '-v', `${names.mediaVolume}:/target`];
    execute([
      'run',
      '--rm',
      '--network',
      'none',
      ...volumes,
      '--entrypoint',
      'sh',
      COPY_IMAGE,
      '-c',
      'cp -a /source/. /target/',
    ]);
    const digest = execute([
      'run',
      '--rm',
      '--network',
      'none',
      ...volumes,
      '--entrypoint',
      'sh',
      COPY_IMAGE,
      '-c',
      'cd /source && find . -type f -exec sha256sum {} + | sort > /tmp/source.sha; cd /target && find . -type f -exec sha256sum {} + | sort > /tmp/target.sha; cmp /tmp/source.sha /tmp/target.sha && sha256sum /tmp/source.sha',
    ]);
    data.mediaSnapshotDigest = digest.split(' ')[0];
    data.status = 'ready';
    data.initialTableCounts = counts;
    writeFileSync(file, JSON.stringify(data) + '\n', { mode: 0o600 });
    return data;
  } catch (error) {
    data.status = 'failed';
    writeFileSync(file, JSON.stringify(data) + '\n', { mode: 0o600 });
    throw error;
  } finally {
    if (running) execute(['start', 'zdm-platform-backend']);
    if (
      data.status === 'ready' &&
      JSON.stringify(JSON.parse(readFileSync(sourceLock, 'utf8'))) === JSON.stringify(lock)
    )
      unlinkSync(sourceLock);
  }
}

export function assertPreviewWriter(data, project, execute = command) {
  const names = execute(['ps', '--filter', 'label=com.zdm.task.preview=true', '--format', '{{.Names}}'])
    .split(/\r?\n/)
    .filter(Boolean);
  for (const name of names) {
    const container = JSON.parse(execute(['inspect', name]))[0];
    if (container.Config?.Labels?.['com.docker.compose.project'] === project) continue;
    if (
      container.Config?.Env?.some((value) =>
        value.startsWith(`ZDM_DB_URL=jdbc:mysql://zdm-platform-mysql:3306/${data.database}?`),
      )
    )
      throw new Error('长期预览库仍被其他任务后端使用，请先显式停止旧任务，不自动抢占');
  }
}
export function protectPreviewUpdate({ root, data, directory, risk = false, stop }, execute = command) {
  const history = rootSql(
    `SELECT script FROM \`${data.database}\`.flyway_schema_history WHERE success=1;`,
    execute,
  ).split(/\r?\n/);
  const pending = readdirSync(directory).filter((name) => name.endsWith('.sql') && !history.includes(name));
  const lock = path.join(previewDataRoot(root), 'update.json');
  if (existsSync(lock)) throw new Error('长期预览数据更新保护尚未完成，保留备份和现场');
  if (!risk && !pending.length) return null;
  const record = { project: data.project, database: data.database, pending, createdAt: new Date().toISOString() };
  writeFileSync(lock, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  stop();
  const backup = snapshotDatabase(root, path.join(previewDataRoot(root), 'backups'), execute, data.database);
  record.backupFile = backup.file;
  writeFileSync(lock, JSON.stringify(record), { mode: 0o600 });
  return { lockFile: lock, lock: record };
}
export function protectIntegrationMigrations(root, catalog, history, execute = command) {
  const pending = catalog.filter((entry) => !history.some((row) => row.script === entry.name && row.success === '1'));
  if (!pending.length) return null;
  const lockFile = path.join(root, 'backups/task-preview/active-database-task.json');
  mkdirSync(path.dirname(lockFile), { recursive: true });
  const lock = {
    type: 'zdm-integration-migration-lock',
    workspaceRoot: path.resolve(root),
    pending: pending.map((item) => item.name),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(lockFile, JSON.stringify(lock) + '\n', { flag: 'wx', mode: 0o600 });
  // All shared writers are stopped before the backup; isolated task backends continue independently.
  const others = execute(['ps', '--filter', 'label=com.zdm.task.database=integration', '--format', '{{.ID}}']);
  if (others) throw new Error('旧共享任务后端仍在写入，保留迁移锁，不启动集成迁移');
  if (execute(['ps', '-a', '--filter', 'name=^zdm-platform-backend$', '--format', '{{.State}}']) === 'running')
    execute(['stop', 'zdm-platform-backend']);
  const snapshot = snapshotDatabase(root, path.join(root, 'backups/integration-migrations'), execute);
  lock.backupFile = snapshot.file;
  writeFileSync(lockFile, JSON.stringify(lock) + '\n', { mode: 0o600 });
  return { lockFile, lock };
}
export function releaseIntegrationMigration(protection) {
  if (!protection) return;
  const stored = JSON.parse(readFileSync(protection.lockFile, 'utf8'));
  if (JSON.stringify(stored) !== JSON.stringify(protection.lock)) throw new Error('集成迁移锁已变化，保留现场');
  unlinkSync(protection.lockFile);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  const [action, root, project, integrationRoot] = process.argv.slice(2);
  if (!['status', 'provision', 'adopt'].includes(action) || !root || !project)
    throw new Error(
      'Usage: task-data-environment <status|provision> <worktree> <project> [integration-worktree]; adopt <worktree> <source-manifest>',
    );
  const value =
    action === 'adopt'
      ? adoptPreviewData(root, project)
      : action === 'provision'
        ? await provisionPreviewData({ root, project, integrationRoot })
        : readTaskData(root);
  console.log(
    value
      ? JSON.stringify({
          status: value.status,
          database: value.database,
          mediaVolume: value.mediaVolume,
          backupFile: value.backupFile,
        })
      : '未建立任务数据环境',
  );
}
