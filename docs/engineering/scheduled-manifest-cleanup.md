# 交付清单定时清理：工程接口

本页描述 683 的源码候选。源码检查点不代表已安装、已周期运行或通知已送达。原暂停任务不由此恢复。清理只消费 987 的已登记稳定移交对象，不扫描历史目录推断残留。

## 683 必要准入升级

本候选精准复用 987 检查点 `67090457bafe7e5b01005196f7d59459efaabfd3` 的控制面桥接：明确选择恢复、协作执行者身份、工程任务开发完成后的串行交付准入。它保留 638 已发布的看板受理保护，不把执行者父聊天活跃当子任务仍运行，不重放历史“任务完成”授权，也不解除未被用户选择的暂停任务。

本次没有引入 987 的统一验证标准、清单生产端或回执恢复成果。683 从现有准确登记交付这项必要升级；发布后 987 的 bootstrap 成果通过已发布 `start` 入口、正式受理和保全转移接续，不新增 `adopt` 或跳过看板登记的入口。真实队列、消息、身份和依赖准入由总调度在发布后核验，源码候选和隔离夹具不是现场授权证明。

## 清单与删除边界

`task-cleanup-queue.mjs` 导出 `cleanupIdentity`、`cleanupObjectId` 和 `createCleanupQueue`。生产者固定为 `task-completion-handoff-v1`；当前仅支持有成功 Vite 构建登记证明的 `dist`。含符号链接的依赖目录、数据库、媒体、备份及共享资产不在当前删除范围。

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
  "notification": { "destination": "01a1e39f-ef43-75e0-b948-e05f5fda634e" }
}
```

前三项预算已由总调度明确选择；scheduler 参数须作为部署配置明确记录。时间预算在对象边界检查，单个外部命令另有固定超时；不能把它解释为删除中途强杀。超预算对象保留，不能拆开后绕过总字节限制。

`metadata` 可选，只有显式加入后才压缩成功结果详情：

```json
{ "retentionMs": 123456789, "maxDetails": 200, "compactLimit": 50 }
```

该数值只是字段格式示例，不是已确认期限。`retentionMs` 为非负整数毫秒，`maxDetails` 为非负整数，`compactLimit` 为 1–1000。超龄或超过详情容量的成功项，先持久化独立 `audit/<key前两位>/<key>.json` 紧凑回执，再删除冗长详情。回执保留任务ID、对象摘要、完成时间、结果、逻辑字节、未证明的物理释放 `null`、异常及首次失败引用；月度摘要不能代替逐项回执。紧凑审计不进入到期活跃查询索引。pending、异常、清单来源、构建证明、正式交付和首次失败证据不会被此到期规则删除。未配置 `metadata` 时保留详情；没有隐含 30 天默认。

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
