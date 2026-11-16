# 交付清单定时清理：工程接口

本页描述 683 的源码候选。源码检查点不代表已安装、已周期运行或通知已送达。原暂停任务不由此恢复。清理只消费 987 的已登记稳定移交对象，不扫描历史目录推断残留。

## 683 必要准入升级

本候选精准复用 987 检查点 `67090457bafe7e5b01005196f7d59459efaabfd3` 的控制面桥接：明确选择恢复、协作执行者身份、工程任务开发完成后的串行交付准入。它保留 638 已发布的看板受理保护，不把执行者父聊天活跃当子任务仍运行，不重放历史“任务完成”授权，也不解除未被用户选择的暂停任务。

本次没有引入 987 的统一验证标准、清单生产端或回执恢复成果。683 从现有准确登记交付这项必要升级；发布后 987 的 bootstrap 成果通过已发布 `start` 入口、正式受理和保全转移接续，不新增 `adopt` 或跳过看板登记的入口。真实队列、消息、身份和依赖准入由总调度在发布后核验，源码候选和隔离夹具不是现场授权证明。

## 清单与删除边界

`task-cleanup-queue.mjs` 导出 `cleanupIdentity`、`cleanupObjectId` 和 `createCleanupQueue`。移交生产者固定为 `task-completion-handoff-v1`；消费者按以下独立证明类型核验，不凭目录名或年龄推断可删：

| 类型                     | 创建或保全证明                                                   | 独立核验                                                                                                        |
| ------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `vite-dist-v1`           | 成功 Vite 构建登记                                               | 准确 `dist` 身份及原有构建登记                                                                                  |
| `e2e-test-build-v1`      | 现有 `prepareApplication` 成功钩子登记 `.task-runtime/e2e-app`   | 构建前后源码不变、准确 Git 输入集合、原 v1 构建产物和策略摘要；不改变 HTML 入口、分片或原证明契约               |
| `generated-fixture-v1`   | 显式创建器按 Git 中固定 JSON 模板及 32 位十六进制 seed 生成      | 仅字面量替换，完整期望文件和目录集合；不执行任务文本，额外唯一文件也拒绝                                        |
| `git-source-copy-v1`     | 显式创建器从准确 Git 对象复制普通受跟踪文件                      | 完整树、逐文件 blob 和模式一致，来源是已交付候选及 main 的祖先；链接、子模块及超限对象保护保留                  |
| `duplicate-preserved-v1` | `preserveAssets` 已将完整报告闭包保存到稳定 manifest 和内容 blob | 只支持 `test-results`、`playwright-report`、`coverage` 的额外原副本；完整成员、字节、模式及稳定原始证据逐项一致 |

前四类使用 `disposition=rebuildable`；报告额外副本使用独立的 `preserved-duplicate`。必要稳定 blob、保全 manifest、首次失败及 `.task-verification` 不由此删除。含符号链接的依赖目录、私有依赖、共享缓存、数据库、媒体、备份及无法证明的报告继续保护；不扫描旧 Worktree 或系统临时目录。

`task-cleanup-created-artifacts.mjs` 提供显式创建器 `createCleanupArtifactProducer`、移交接口 `handoffCreatedArtifacts({root,common,task,proof,assertUnreferenced}, {api})` 和只读 `readCreatedArtifactInventory({root,common,task})`。索引固定在 `common/task-cleanup/created/<task>/index.json`；外部源码容器固定在 `common/task-cleanup/created-sources/<task>/<uuid>/content`，由创建时记录精确绑定，不根据已移除的 Worktree 猜路径。只读清单返回真实登记状态和 `existence=not-probed`，不将缺失对象当作已释放空间。移交返回 `registered`、`handedOff`、`protected`，供 987 汇入统一收尾清单。

仅存在准确任务私有 `task-artifacts` 和登记绑定时，现有 E2E 创建钩子才登记；未知 Vite 环境、源码变化及失败构建保护保留。夹具和源码副本只接显式新适配，不全库替换 `mkdtemp`；外部源码创建器上限为 128 MiB，超限拒绝而不截断。创建、挪移和发布保存稳定 journal，队列发布中断后按同一对象接续，不创建第二份副本。

收尾顺序为完整证据保全、稳定 staging 移交、最后 Git 载体回收。原载体先消失不能补造清理成功。报告保全原 manifest 为 JSON 数组，消费者只选择准确前缀且要求全部为 `generated-output`；额外副本的文件模式由创建证明记录，原保全 manifest 无须新增模式字段。

稳定路径为 `git-common-dir/task-cleanup/staging/<task>/<object-id>/content`。同目录 `manifest.json` 和 `proof.rebuild.record` 是只写一次的审计来源，消费后继续保留；不能随删除目标一起移除。consumer 独立核验正式关闭、原候选/验收/main、证明原始字节、准确对象身份、打开文件和本机 Docker 引用。无法证明时保留对象。

删除通过 `task-cleanup-delete.py` 的目录描述符完成，不跟随链接。状态先持久化再挪移/删除；部分删除仅允许继续处理原封闭清单中的剩余成员，新文件或路径复用会阻断。对象原本已不存在，记 `already-absent`，不能作为真实清理验收。逻辑字节与实际物理释放分别记录，后者未证明时是 `null`。

## 显式 policy

配置位置为 `git-common-dir/task-cleanup/policy.json`，文件必须为普通文件、权限 0600，祖先路径无符号链接。未配置拒绝真实 `run`。以下为首次部署的完整配置示例，文档本身不写入配置：

```json
{
  "version": 1,
  "limit": 10,
  "budgetMs": 120000,
  "maxLogicalBytes": 1073741824,
  "scheduler": { "historyLimit": 20, "maxSummaryBytes": 4096 },
  "metadata": { "retentionMs": 2592000000, "maxDetails": 200, "compactLimit": 50 },
  "notification": { "destination": "01a1e39f-ef43-75e0-b948-e05f5fda634e" }
}
```

上述参数已由总调度明确选定：每轮最多 10 个对象、120000 毫秒、1 GiB 逻辑字节；调度历史最多 20 条、每条摘要最多 4096 字节；每天 Asia/Shanghai 01:00、13:00；通知固定到上述真实 chat。文档记录不等于已写入真实 policy 或启用日程。时间预算在对象边界检查，单个外部命令另有固定超时；不能把它解释为删除中途强杀。超预算对象保留，不能拆开后绕过总字节限制。

`metadata` 的当前部署选择如下，须由已发布版本显式配置后才压缩成功结果详情：

```json
{ "retentionMs": 2592000000, "maxDetails": 200, "compactLimit": 50 }
```

成功详细记录超过 30 天或超过 200 份上限，每轮最多压缩 50 份。程序仍要求显式 `retentionMs`（非负整数毫秒）、`maxDetails`（非负整数）、`compactLimit`（1–1000），不设置隐含 30 天默认。符合条件的成功项先持久化独立 `audit/<key前两位>/<key>.json` 紧凑回执，再删除冗长详情。回执保留任务ID、对象摘要、完成时间、结果、逻辑字节、未证明的物理释放 `null`、异常及首次失败引用；月度摘要不能代替逐项回执。紧凑审计不进入到期活跃查询索引。pending、error、异常、清单来源、必要构建证明、正式交付和首次失败证据不会被此到期规则删除。未配置 `metadata` 时保留详情。

## 稳定运行与计划生成

`publishCleanupRuntime(mainRoot, {expectedHead})` 是显式部署函数，只接受干净 main 且 HEAD 与 origin/main 跟踪引用相等；它不宣称实时查询远端。root 在正式主线交付与来源核验后调用。函数从准确 Git 对象复制全部受跟踪 scripts（包括 Python 子进程辅助文件），写入 owner-only 的 `task-cleanup/runtime/<main-sha>/`。每次执行前核对输入摘要和 Node 身份，任务 Worktree 移除不影响运行。历史 runtime 版本保护保留，不在此入口猜测删除。

`cleanupLaunchAgentPlan({root,node,commonDir,runtimeDirectory})` 只生成 plist，不安装。它直接调用稳定 runtime 的 `task-cleanup-scheduled-cli.mjs`，每天北京时间 01:00、13:00；宿主时区必须是 Asia/Shanghai。`RunAtLoad` 用于登录/重载后仅补最近时点；同一时点已领取不重跑，跨越多个时点也不逐轮回放。并发和失主锁保留，不以超时抢占。

launchd 的日历任务会在睡眠唤醒后补触发；关机错过的时点不能依赖日历任务自动补跑，因此另有启动时最近时点核验。参考 [Apple 定时任务文档](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html)。

不创建每轮聊天。无追加增长的 stdout/stderr 文件；调度写定长数量的结构化最近记录，并保留首次失败。JS 已启动时的预检错误覆盖写入 `scheduler-startup-error.json`。若 Node 或进程根本无法启动，必须由现有外部监测读取 launchd 的 LastExitStatus；进程自身无法证明这一情况。尚未接通外部观察前不能宣称不存在静默停机。

## 固定通知宿主接口

清理本机脚本不调用假设存在的消息 API。现有固定监测宿主可查询同一 commonDir 的本清理通道；清理对象所属任务可以是 987 等其他已交付任务，不应只过滤 `artifact.task=683`，也不据此扫描或恢复其他执行队列。

从稳定 runtime 调用 `task-cleanup-cli.mjs`，cwd 为 main 锚点：

宿主还需查询 `schedule-status`：这是不读取对象索引的固定调度/启动错误快照。若对象索引本身损坏，通知列表可能无法读取，应据此快照及 launchd LastExitStatus 报告 unknown/failed，不能视为空队列或正常无通知。过往启动错误须与最近成功时间比较，不能将历史错误当新故障重复发送。

1. `pending-notifications` 返回 `notifications[]`：`key,id,eventId,text,delivery`。这里只证明待投递事件，不证明送达。
2. 宿主读固定目标身份后，将准确 `key,id,eventId` 写入一个本机 JSON，调用 `claim-notification <event.json>`。只有 `status=send-once` 才能发送。实际 `claimedAt` 随领取记录持久化，并由 pending 的 `delivery` 原样返回；读回时间不得早于领取时间。领取后即使中断，也不能盲目重发；后续 `delivery-unknown` 需查询原发送结果。
3. 向已配置的固定 chat 发送原样 `text`，保存平台实际 messageId，再从同一 chat 读取该消息全文。
4. 写入下列回执，调用 `ack-notification <receipt.json>`。固定目标、事件、messageId 和全文不一致均拒绝。stdout、退出码或“已发送”文字不能替代原生读回。

```json
{
  "key": "<64hex object key>",
  "id": "<exact notification UUID>",
  "eventId": "<exact 64hex event ID>",
  "receipt": {
    "provider": "codex-fixed-channel-readback",
    "destination": "<policy fixed chat>",
    "messageId": "<actual platform message ID>",
    "deliveredAt": "<observed ISO timestamp>"
  },
  "readback": {
    "roomId": "<same fixed chat>",
    "messageId": "<same actual message ID>",
    "text": "<exact original platform message text>"
  }
}
```

发送适配也可通过 `flushCleanupNotifications` 显式注入 `readThread/sendMessage/readMessage`。这与现有 Codex host 的接口边界一致；原始返回值须规范化为此处字段。成功读回先落盘，再 ack；落盘后 ack 中断可接续而不重发。同一未变故障不每周期制造新事件。失败和未知送达保持 pending，既有首次失败不被覆盖。

通知有独立持久 outbox 与活跃索引，保留到准确 ack；对应对象随后恢复并成功清理、关闭对象 pending、压缩成功详情，都不会吞掉未送或 unknown 通知。不同故障事件可以分别确认，旧事件回执只能确认对应事件，不能顺带确认新事件。

本机 owner-only 文件不是独立防伪边界。具有同一用户写权限的人可改变记录，不宣称不可绕过。源码隔离测试与真实投递验收分开，正式启用仍须来源发布、显式 policy、987 真实清单、01:00/13:00 周期触发与原生通知读回证据。

## 任务私有依赖：分包独立审计

后续 683 版本新增 `npm-pristine-package-v1`，不混入已冻结的 987 候选。它明确是 `independent-archive-audit-v1` 审计证明，不是补造创建时凭证，不把 `npm ci` 退出 0 当作目录没有唯一内容的证明。

`task-artifacts` 仍执行原有 `npm ci`，不修改生命周期脚本、参数或依赖运行行为。仅本次实际新安装并验证、写入准确私有 task-artifacts 后调用审计；正常复用不重复全目录审计。旧准确任务可以显式调用 `auditPrivateTaskDependencies({root,common,task})`。审计只读取该任务 `.task-runtime/npm-cache/_cacache/content-v2/sha512` 中按锁文件 integrity 精确定位的归档，不联网、不查共享 npm/Maven 缓存、不扫描历史安装。

审计逐个处理 lock 中准确顶层或作用域包：要求实体私有 `node_modules`、task/worktree/lock 绑定、归档 SHA-512 完全一致、包内完整目录与文件集合及字节摘要相同。普通文件仅接受固定 npm 规范化 0644/0755 模式；未知模式、链接、硬链接、额外空目录、新增文件、缺失或修改内容均保留。带 `hasInstallScript`、嵌套或打包内含 node_modules 的包不纳入首期。`.bin`、安装索引、未知根成员、私有缓存、补丁及备份均保留，不放宽任何类型的全局链接规则。

Python 归档检查器只读取、不解包或执行；压缩大小、解压容器、文件总量和成员数量均有界，拒绝越界路径、重复、链接、特殊模式及特殊文件。审计成功先将完整原归档以 owner-only、内容寻址方式保存在 `common/task-cleanup/dependency-archives/<task>/<sha512hex>.tgz`，再写不可覆盖证明。稳定索引为 `common/task-cleanup/npm-audits/<task>/index.json`；旧 Worktree 移除后，消费端仍能从准确 Git lock 与稳定原归档独立核验完整预期内容。

`readDependencyCleanupInventory({root,common,task})` 只读登记，返回 `registered/artifacts/protected/summary`；不存在登记明确保护 node_modules。`handoffAuditedDependencies({root,common,task,proof,assertUnreferenced},{api})` 只按已有审计移交，重新核对原私有绑定、准确输入、稳定证明路径、归档存在性、封闭对象元数据身份和整个 node_modules 的活跃引用。证明成本放在独立审计，收尾不重复解包或逐字节读包；移交不授权删除。先保存 moving journal 后挪入稳定 staging，再发布到同一清理队列。消费时独立完整核验归档完整性及当前包字节后才允许 FD 删除；错误生产者即使封入额外唯一文件也不能获删除。其他类型的既有入队/消费保护不变。重复调用和发布中断接续原对象；缺失对象不记释放空间，失败原因进入只读清单。

报告区分 `auditedPristinePackages`、`protectedLockPackages`、`protectedRecords`、审计逻辑字节和实际 staging 数量；`physicalBytes` 仍为 `null`。审计通过不等于已清理；正式关闭、准确交付及消费时引用证明继续必需。归档、原 cache 和所有 protected 内容必须先保全，未来总清单接线不能通过回收 Git 载体吞掉它们。本版本不执行真实依赖挪移或删除，不安装定时器，待正式发布后由总调度按准确任务小范围验证。

683 隔离组合固定 987 源 `5926eed298b79dc925a1ac2b8f4ff0e49844e352` 后，正式收尾 `preserve` 阶段已接依赖移交，顺序为 `handoffAuditedDependencies`、原 `preserveAssets`、报告额外副本移交、统一总清单。残余私有依赖仍由原 `retainTaskDependencies` 完整保全，不将部分 pristine 包的可清理性套到整目录。总清单同时读取稳定 npm-audits 索引、准确移交结果和保护原因；已移交对象仍标记 `spaceReleased=false`。本组合不冒充已发布能力，不修改正在交付的 987 固定源。
