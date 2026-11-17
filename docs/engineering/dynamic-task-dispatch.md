# 持续委托与动态任务调度

本入口只处理同一项目中已正式受理、登记且具有原票据的任务。不创造业务授权，不迁移 owner、不改变冻结，不代替来源证明、验证、数据保护或最终 main 互斥。

## 真实委托与独立决定

在干净且与 origin/main 一致的已发布 main 运行 `node scripts/task-thread-host-bridge-cli.mjs`，通过隐藏 PTY 提供既有看板 url/token、真实原生观察及容量。凭证不进参数、环境、文件或日志；涉及进程、打开文件、Docker 的首次调用使用有效最小授权。

当前协调者先调用 `action: "delegate"`，`task` 输入包含：

- `coordinatorThreadId`：与 current.json 及真实执行环境一致。
- `authorityId`：为该委托持久保存的 UUID。
- `request`：真实用户消息的 messageId、roomId、authorId、sequence；原生消息必须实际读回，不为每次调度编造用户事件。
- `taskIds`：准确工程任务 ID 清单，逐项核对登记、原票据、同一用户和未完成看板记录。
- `expectedQueueRevision`、`expectedCoordinationRevision`：本次实际版本。

原消息、范围、历史 owner 与摘要进入队列的 `dynamicAuthorities`。一条真实委托支持多个不同决定；后续不要求旧授权聊天永久可读，但每次仍核验 current.json 当前角色、同一用户及新鲜当前角色观察。旧协调者不能冒用新角色。更新的 pause 撤销旧委托，不按超时重新启用。

## 预约与实际 worker 消费

`action: "dispatch"` 由真实当前协调者调用：

| 字段                         | 含义                                                             |
| ---------------------------- | ---------------------------------------------------------------- |
| authorityId、decisionId      | 原委托与本次唯一 UUID；精确回放只读，不能改载荷再用              |
| task、owner、executor        | 工程 ID、保留的历史 owner、当前真实 worker                       |
| lane、phase                  | development/development，或 delivery/preparation、delivery/final |
| coordinatorThreadId          | 实际当前协调者                                                   |
| expectedQueueRevision        | 当前队列版本                                                     |
| expectedTaskRevision         | 当前任务登记版本                                                 |
| expectedCoordinationRevision | 当前协调路由版本                                                 |
| expectedBoardRevision        | 本次真实看板版本                                                 |

仅选择原清单中依赖已正式交付的任务；依赖须有关闭回执，且其 main 在 origin/main 祖先中。任务、绑定、票据、源码/索引、原冻结与资源前后稳定，worker 原生状态 idle/error，完整本机观察证明无目标写入者后才预约容量。历史来源沿用既有恢复证明；冻结后工程 checkpoint 只经原业务/控制面快照校验。

未冻结任务在绑定后的源码变化，只接受合法开发准入下已登记的准确 checkpoint：工作区干净、HEAD 等于 recordedHead 且有该提交的 checkpoint，记录晚于当前 binding；原 resume-selected/bindingRef 或已消费动态决定证明准确 worker/owner/admission，全部非主线提交有本任务归属且不占用其他任务 checkpoint。决定保存 taskRevision、绑定版本、准确提交/树、checkpoint 及归属证明，消费前重新比对。未登记 HEAD、脏改动、归属或开发准入不明仍拒绝，不重写初始绑定摘要，也不重建冻结。

容量在原 limit/activeDevelopment/activeDelivery/activeOther 上增加 activePreparation。limit 来源须如实说明，项目预算不称为平台硬上限。运行中的开发、准备、最终交付、其他执行者及未消费决定、原生创建预约均计入，仍保留一个最终交付执行位。未知容量、依赖、资源或版本变化只阻断相应决定。

预约返回 workerInput，不代表开始工作。宿主真实发送给该 worker；worker 以自己真实 CODEX_THREAD_ID 调用同一桥 `action: "dispatch-start"`，传原 workerInput 和新读回的 expectedQueueRevision，提供新鲜角色、worker 与容量观察。消费前再次核验依赖、容量、源码、票据和绑定。成功只返回 admitted-work-not-started、准确任务、monitorContext 和 admission；worker 再按既有入口恢复私有依赖并执行，不伪报预览就绪。

精确回放不重放启动或轮换 admission。结果未知先查原决定和实际 worker/资源。未消费预约只能由当前协调者用 `action: "dispatch-cancel"`、准确 decisionId 及当前队列/任务/协调版本，在 worker 空闲且原票据未消费的证明下撤销。它保留历史，不取消任务或释放未知运行，不按超时自动回收。

## 准备与最终交付分离

准备 scope 只允许原源码冻结、prepare、本候选 PR 等待和修复记账；不允许任意 measure shell、普通 deliver、main 等待、恢复/合并、集成同步、final-handoff、settle 或清理。

worker 携带本任务准确 admission 使用：

```sh
npm run task:entry -- --worktree "<准确任务目录>" complete prepare "<准确任务ID>" "<40位候选SHA>"
```

该入口沿用来源、资产、保护与 CI 检查，发布原快照及准确分支、创建 PR、等待第一次完整适用 PR CI。成功返回 prepared、准确 head、原 accepted、PR、runId；formalDeliveryComplete 始终为 false。不进入最终 main 队列，不组成 main、不合并、不交接、不 settle。各任务独立准备可并行。

准备结束后 worker 调用 `action: "preparation-finish"`，提供 decisionId、task、当前 coordinatorThreadId 和 expectedQueueRevision。入口核对精确工作树、原冻结及 session 中该候选首次成功 PR CI，保存证明，仅撤下自己的准备 scope；原票据 owner/order/request、blocked 状态和原因原样恢复，不关闭任务或改其他票据。

协调者可据持续委托选择任一依赖就绪任务，记录新的 delivery/final 决定。最终 scope 同时只能一个；实际 main、main CI、共享交接和结项仍由原 task-delivery-queue 串行。worker 继续普通 complete deliver，精确 CI、组合候选、快照、运行交接和回执门禁保持。

已消费 binding 后再 block 的任务可凭新的真实决定安全续接；不重放旧 bindingRef，不伪造用户消息。每次保留原票据快照、失败、新 admission、依赖、容量和现场证明。completed/cancelled 的同一 lane、closed 任务、越界任务、外部 worker、旧协调者、来源不明或仍运行的目标继续拒绝。

新策略仅在隔离 Git/队列/原生观察测试中验证，独立受信发布后才能用于真实任务。本地代码、账本和宿主观察不是独立账号或不可修改的安全边界，不宣称不可绕过。

## 已知创建失败的新尝试

`action: "retry-creation"` 仅供当前真实协调者处理已知 native 结果且完整创建输入被追加说明而拒绝的情形。`task` 传原 taskId/title/kind/owner/rootThreadId/request，另提供 coordinatorThreadId、唯一 decisionId、原 originalRequestId、已知 threadId、真实 retryRequest，以及 expectedQueueRevision/expectedCoordinationRevision/expectedBoardRevision。retryRequest 引用适用的真实用户消息，允许复用持续委托，不伪造新用户事件。

入口重新执行原精确校验，确认实际失败原因；要求唯一完整原生 create_thread 来源、原 root/任务/nonce 和未改动的原提示正文。追加内容只作为失败证据归档，旧聊天仍不准绑定。确认旧聊天真实 idle、原票据仍 awaitingNativeWorker/queued、无绑定、任务登记、start-intent、任务 Git 载体、数据和交付资产，两次本机观察无目标资源，容量允许后，保全原记录原始字节、完整实际输入及原生观察、失败原因、真实授权和摘要。

原档保存在 task-thread-titles/failed-creations 下，当前索引指向独立新尝试及新 nonce；新计划仍由真实宿主调用 create_thread。后续 receive/continue-intake 以新 requestId 读回实际结果，再经过完全相同的精确创建、标题、绑定和 start 检查。该入口不登记工作区、不启动任务、不修改原队列 owner 或位置。相同恢复决定只读回放，不重复发计划；新的结果未知、归档中断、已有替换尝试、未知/notLoaded/权限不足、仍活动或已有资源均保留现场，不再次创建。候选代码不能提前用于真实 344。
