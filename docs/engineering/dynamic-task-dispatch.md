# 持续委托与动态任务调度

本入口只处理同一项目中已正式受理、登记且具有原开发或交付票据的任务。不创造业务授权，不迁移 owner、不改变冻结，不代替来源证明、验证、数据保护或最终 main 互斥。

## 真实委托与独立决定

在干净且与 origin/main 一致的已发布 main 运行 `node scripts/task-thread-host-bridge-cli.mjs`，通过隐藏 PTY 提供既有看板 url/token、真实原生观察及容量。凭证不进参数、环境、文件或日志；涉及进程、打开文件、Docker 的首次调用使用有效最小授权。

当前协调者先调用 `action: "delegate"`，`task` 输入包含：

- `coordinatorThreadId`：与 current.json 及真实执行环境一致。
- `authorityId`：为该委托持久保存的 UUID。
- `request`：真实用户消息的 messageId、roomId、authorId、sequence；原生消息必须实际读回，不为每次调度编造用户事件。
- `taskIds`：准确工程任务 ID 清单，逐项核对登记、原票据、同一用户和未完成看板记录。
- `expectedQueueRevision`、`expectedCoordinationRevision`：本次实际版本。

原消息、范围、历史 owner 与摘要进入队列的 `dynamicAuthorities`。一条真实委托支持多个不同决定；后续不要求旧授权聊天永久可读，但每次仍核验 current.json 当前角色、同一用户及新鲜当前角色观察。旧协调者不能冒用新角色。更新的 pause 撤销旧委托，不按超时重新启用。

## 开发完成后的交付阶段入队

只有已完成开发票据、尚无 delivery 票据时，当前真实协调者先调用 `action: "delivery-enroll"`。`task` 输入使用 coordinatorThreadId、authorityId、唯一 phaseId、task、owner、executor、expectedQueueRevision、expectedTaskRevision、expectedCoordinationRevision、expectedBoardRevision，以及原 `completion.digest` 对应的 developmentEvidenceDigest；不提供 lane、phase、新 request 或新 sequence。

入口重新核验已保存的真实持续委托、同一用户、当前角色与 worker、依赖、未暂停/终态看板，以及原完成事件、报告和源报告哈希、干净准确 HEAD、登记 checkpoint 与提交归属。原开发完成票据不变，新 delivery 票据使用其原 request 和 order，状态仅为 queued、admission 为 null。该派生票据不能经普通 claim 或 resume 绕过 dispatch 决定，即使全局恢复也不因此取得最终执行许可。phaseOrigin 和独立阶段事件保存原开发票据摘要、完成证据、准确来源、原顺位、真实委托及阶段 UUID；既有 delivery 票据不被接管，精确重放不重新授权工作，暂停后旧委托失效。多个任务可以引用同一真实委托，不伪造新用户消息或收件序号。

该步骤只登记元数据，不启动、停止或清理环境，不预约准备容量或最终 main，不要求先 promote 再伪造 block。环境和数据仍完整保留；登记成功不表示旧运行环境可接管。之后仍走下节的 dispatch/dispatch-start，重新证明目标写入者空闲、资源、依赖和实际容量；未知或尚未安全恢复的运行引用仍会阻断实际准备。未冻结的完成源码仅在对应 phaseOrigin 和完整原开发完成来源一致时作为准备 checkpoint，worker 实际取得 preparation 准入后才由原 complete prepare 入口冻结业务并验证、推送及执行 PR CI。不会将已完成的开发 lane 重新改为运行。

交付阶段入队只登记内部票据，保留已有待验收进度。看板暂停投影仍受真实用户暂停约束，更新的暂停指令会撤销早于它的委托。

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

macOS 的派发预约和消费可分别证明 Docker Desktop 保留的只读目录引用。每次都在当前本机 Unix socket 上核验已签名的 Docker 端点持有者、实际加载的可执行文件、启动身份、目录持有者和其内核目录句柄。两轮观察均须排除目标任务进程、其他文件或目录引用，以及运行和已停止容器的重叠挂载。挂载按实际设备和 inode 核对父子目录。证据变化或不完整时维持拒绝；消费须重新得到相同的引用身份。私有证据保留每个仍被引用的目录、实际挂载和资源证明。该证明的使用范围仅为动态派发，不提供取消、历史重绑、停止运行环境或物理清理许可。

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

### 暂停后恢复已退出的 PR 准备

已重新委托的历史任务如果仍持有上一次准备的专属租约，且本地唯一未终结的阶段正在等待已成功的首次 PR CI，当前协调者可在已发布的同一宿主桥调用 `preparation-recovery-plan`。原执行对话须已空闲。输入包括当前 `coordinatorThreadId`、覆盖该任务的暂停后 `authorityId` 及其原样 `request`、工程 `task`、历史 `owner`、绑定的 `executor`、旧准备的 `decisionId`、本次唯一的 `recoveryId`，以及实际读回的 `expectedQueueRevision`、`expectedTaskRevision`、`expectedCoordinationRevision` 和 `expectedBoardRevision`。从原冻结和准备会话取 `accepted`、`head`、数字 `pr`、字符串 `runId` 和未终结等待的 `eventId`。宿主提供当前角色、工作对话的原生观察和真实看板读回。入口自行读取原 PR 和运行，检查本机进程、打开文件和容器。

计划在任务私有交付目录的 `preparation-recovery` 下封存原租约、会话、全部进程日志、冻结记录、原票据和远端运行身份。协调者将返回的准确 `workerInput` 交给原执行对话。该对话以自己的身份调用 `preparation-recover`，重新核对版本、文件身份及进程组。成功回执记录原 PR、首次运行、原顺位和恢复后的会话摘要。本地等待按中断记账，停止时间保留为未知。任何活动或复用的进程标识、缺失或额外日志、文件被替换、另有预约或准入都要求保留现场。

这两个动作的 `admission` 均为空。原执行对话结束恢复轮次后，总协调沿原 delivery 票据重新调用 `dispatch`，由原执行对话消费新的准备准入。原执行对话可在新准入下用既有的 `complete wait pr <原候选 SHA>` 读回该候选的完整门禁，核对结果中的 runId、headSha 和 attempt 与恢复回执及原运行相符。后续候选发生变化时沿正常准备流程验证新候选。操作结果未知时，按同一 `recoveryId` 和计划摘要查原回执。相同输入可接续已封存的中断步骤，来源或版本发生变化时须先重新核实。

新策略仅在隔离 Git/队列/原生观察测试中验证，独立受信发布后才能用于真实任务。本地代码、账本和宿主观察不是独立账号或不可修改的安全边界，不宣称不可绕过。

## 已知创建失败的新尝试

`action: "retry-creation"` 仅供当前真实协调者处理已知 native 结果且完整创建输入被追加说明而拒绝的情形。`task` 传原 taskId/title/kind/owner/rootThreadId/request，另提供 coordinatorThreadId、唯一 decisionId、原 originalRequestId、已知 threadId、真实 retryRequest，以及 expectedQueueRevision/expectedCoordinationRevision/expectedBoardRevision。retryRequest 引用适用的真实用户消息，允许复用持续委托，不伪造新用户事件。

入口重新执行原精确校验，确认实际失败原因；要求唯一完整原生 create_thread 来源、原 root/任务/nonce 和未改动的原提示正文。追加内容只作为失败证据归档，旧聊天仍不准绑定。确认旧聊天真实 idle、原票据仍 awaitingNativeWorker/queued、无绑定、任务登记、start-intent、任务 Git 载体、数据和交付资产，两次本机观察无目标资源，容量允许后，保全原记录原始字节、完整实际输入及原生观察、失败原因、真实授权和摘要。

原档保存在 task-thread-titles/failed-creations 下，当前索引指向独立新尝试及新 nonce；新计划仍由真实宿主调用 create_thread。后续 receive/continue-intake 以新 requestId 读回实际结果，再经过完全相同的精确创建、标题、绑定和 start 检查。该入口不登记工作区、不启动任务、不修改原队列 owner 或位置。相同恢复决定只读回放，不重复发计划；新的结果未知、归档中断、已有替换尝试、未知/notLoaded/权限不足、仍活动或已有资源均保留现场，不再次创建。候选代码不能提前用于真实 344。

初始尝试遗留进展只允许处理原 outbox 的最多两条初始 queue/receive 投影：原始 schema、从未 prepare、没有 failure/未知写入、无已确认或拒绝回执。宿主在顶层 progressNativeObservations 传完整原生 UJ 读回，逐项包含 provider=codex-native-task-board、operation=task_history 或 get_task_progress_receipt、准确 args、observedAt 及原 ToolResult；所有 receipt 均 not_found，完整历史连续且与新鲜真实看板一致、从未应用原 ID，才可继续。不得把审批拒绝写成服务端 stale/invalid。

task.progressWriteAssessment 由当前真实协调者根据原客户端轨迹提供 coordinatorThreadId、originalRequestId、outboxSha256、准确 receiptIds 及 outcome=never-prepared-no-unknown-write；手工或非 outbox 传输结果未知时必须报告未知并拒绝。若原包包含 paused，还须 task.progressReviewEvidence 保存真实客户端审批拒绝：provider=codex-auto-review、outcome=rejected-before-submission、nativeCallId 和完整 originalResult；不得伪造 serverResponse。此为当前协调者的客户端证据与声明，不能称为独立远程证明。

关闭来源不是用户传入的同形 JSON。正式恢复入口完成原生失败、空闲、无绑定/开工/资源及准确票据核验后，封存 contract=known-failed-native-intake-unsubmitted-v1/state=closed-known-failed，绑定原 nonce、完整原包 entryDigest 清单和实际证据摘要。只读 readClosedCreationAttempt 从私有不可变归档重验原始记录字节、完整 native 来源与追加输入失败、关闭状态和全部清单；原 creation-unknown 本身不能归档。未投递保全只消费该 reader，不借用 stale/invalid 路径。

归档先 fsync 保全原 outbox 字节、包、序号、时间、客户端拒绝和完整原生读回；本地事务仅将它们登记为 retired-attempt-not-delivered，不加入 acknowledged、不删除首次事实。原序号不重排，只生成新的真实 queued 投影。相同恢复决定不重复生成；归档后、发布新计划前发生本地锁冲突时，保留首份归档和新 nonce，重新核验后续接同一决定；新计划索引持久化后才暴露 native create，结果未知则只读回原结果。准备过的新进展仍阻断，不能跨过未知写入。新受理任务只有仍为 `queued` 且 `admission: null`，并能证明请求属于同一用户且收件序号晚于准确的 `initialize` 或 `pause-all` 围栏，才适用此等待投影。它包括仍处于 `awaitingNativeWorker` 的任务，也包括已在开发队列绑定但尚未启动的任务。已绑定任务必须保有 `nativeLaunchReserved`，协调者与执行者必须不同，且账本中有该任务、协调者和执行者全部匹配的 `bind-native-worker` 事件。未知围栏、旧请求、已取得准入、缺预约或缺准确绑定事件的情况均不适用。后续真实用户暂停仍投影为 `paused`，并撤销旧启动许可。

## 原验证后端停用后的准备准入

任务原 final 验证停止后，若 OS 仍显示 Docker Desktop 持有其目录句柄，只有已发布的准备守卫可以消费该任务原恢复回执。对同一原受阻票据申请新的 `dispatch` 后，在 `dispatch-start` 消费前再次执行完整两轮本机观察。回执、准确候选、容器的停止身份以及证明摘要必须一致。

守卫复用已发布的 Docker 端点、签名代码、实际文件描述符与目录 vnode 核验。仅接受观察中实际读到的数字、只读 DIR 句柄，且没有任何运行中源挂载或重叠挂载。写句柄、普通文件、cwd、套接字、未知进程、状态变化或缺失证据仍阻断。此分支只用于原任务的新准备准入，开发、最终交付和取消继续使用各自的原守卫。目录仍被引用，证明不授权删除或清理。
