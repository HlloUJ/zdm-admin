# 任务执行顺序：两条机械 FIFO 队列

批准方案：开发中、合并到主线各最多 3 个（试行），独立计算。用户执行指令的实际收到顺序是唯一排队依据。代理只忠实执行，不推理调整顺序、优先级或依赖关系。完成释放本阶段槽位；真实阻碍保留槽位并反馈用户，由用户决定下一步。本文不改变验收或正式发布授权。

## 两层而非替换

任务准入账本位于 git common dir 的 `task-registry/execution-order/state.json`。它只处理显式事件、准入和完成，不运行后台服务、不启动线程、不执行任务、不自动重试、不恢复 owner、不修改硬件调度。现有 `task-delivery-queue` 的最终 main/共享环境互斥原样保留；最终资源暂时释放不代表任务级槽释放。921 验证作业资源调度和284只读监测都不因本方案启用。

## 激活边界

候选代码不等于已发布入口。当前开发不得初始化真实账本、恢复旧任务或启动自动化。代码经另外授权正式发布后，使用已发布 `task:entry execution-order initialize <JSON事件>` 单独初始化；初始全局暂停，既有任务不自动迁移或收编。只有用户另行明确恢复及准确登记的任务才能运行。不存在账本时保持已发布历史行为，不能声称 FIFO 已启用；目录已存在但账本缺失/损坏则拒绝，不自动重建或退回旧模式。

## 根线程与原执行者契约

1. 根线程核实真实用户消息、作用范围和暂停指令，先为消息分配持久、严格递增的收件序号。保存 `messageId`、`roomId`、`authorId`、`sequence`。命令参数只是来源记录，不是平台授权，不能用编造事件代替真实授权。
2. 用 `enqueue` 登记 `lane`（development/delivery）、准确 `task`、真实原 `owner`、`request`。不得根据代码依赖、预计耗时或任务编号排序；迟到事件和冲突顺序拒绝并反馈，不能补插改变顺序。
3. 有槽时对队首 `claim`，取得原任务唯一 admission；此后才派发原执行者。相同 claim 重读不表示允许再次派发。根线程须保存平台执行者回执，发送结果未知时不重复启动。
4. 执行原已发布入口时传递 `ZDM_EXECUTION_ADMISSION`。开发新建和恢复在 `task-start` 入口校验；正式交付在 `completionCommand` 的冻结、私有锁恢复、自动恢复和交付副作用之前校验。暂停后拒绝新的受管命令，但不会自行杀死在途进程或 CI。
5. 真实阻碍调用 `block`，原槽保留；根线程将任务编号、阶段、原因/未知状态和已知时长同步到现有任务卡与用户。卡片修改须用准确 stable ID/最新 revision，不覆盖冲突。仓库 CLI 不具有消息或看板写权限，不宣称已通知。
6. `direct` 只接受另一次明确用户事件的 pause-all、resume-all、resume-task、reorder。全局恢复不自动恢复 blocked；任务恢复保持原 owner，更新 admission。不能靠进程退出、资源空闲、超时或重跑 deliver 自动解阻。用户明确改序时，reorder 必须指定准确 lane 及该队列全部且仅排队中的任务顺序；保存原收件序号与调整前后顺序审计，不改已占槽任务、不释放 blocked、不推导依赖。队列满时改序不会创造空槽；暂停/释放占槽需用户另外明确决定，取消只能走下节独立 `cancel` 入口，不隐含释放。
7. `complete` 只验证已有阶段证据并释放槽，不自动运行下一任务。原执行者/根线程收到完成事件后机械 claim 队首并按原指令派发；无持续平台完成回执时必须如实报告尚无自动接续保证，不能靠脚本假装平台常驻调度。

## 完成证据，不改验收标准

开发完成必须工作树干净、准确 HEAD、原 owner，并引用本任务的已成功验证报告，不以 checkpoint、工具退出或聊天总结作为完成。报告封装格式为 `{version:1, task, head, outcome:'passed', tests:正整数, skipped:0, retries:0, sourceReports:[{path,sha256}]}`，由原执行者从已有必要测试结果形成，不能制造测试结果。complete 的 evidence 为 `{task, owner, head, reports:[{path,sha256}]}`，原报告和封装都须保存在本任务目录并核对摘要。该适配器证明内容绑定，不提供独立防伪，也不决定测试范围；原项目适用门禁继续有效。

交付完成复用原 `deliveryStatus.formalDeliveryComplete` 的关闭登记、主线 CI、正式运行交接和回执证明，evidence 指明 `{task,main}`。仅合并、PR绿灯或暂停都不释放交付槽。用户验收仍是独立规则。

## 实际覆盖及限制

覆盖 task:entry start、task:start/task:micro 的函数入口；complete及task:completion通过completionCommand的实际变更路径（begin/freeze/deliver/recover/measure/final-handoff/settle等）。只读 status/report/handoff-plan/check-source 保持可用。低层直接 Git/编辑/preview/data、直接导入内部交付函数、平台原生子线程启动不受该账本强制拦截，必须由根线程遵守准入契约；本地拥有文件写权限的人也可改账本，因此不是不可绕过安全边界。未增加任何命令凭据权限或主线保护例外。

全局暂停、错误、完成事件在账本持久保存，异常不自动更换通道或重试。状态文件原子写入并复用 registry 原始锁；锁异常保留，不按时间抢占。测试仅使用隔离账本，禁止向真实任务登记测试数据。

## 明确取消：只释放准确 blocked 槽，不启动下一项

已发布后使用 `task:entry execution-order cancel <JSON>`。只读预检为 `task:entry execution-order cancel-plan <JSON>`，只需 lane/task/owner/admission；不变更队列、不获取写锁、不消费取消事件，成功也不是未来取消授权，真正取消仍重新核查。预检只输出摘要，不输出进程参数或容器环境。JSON 必须包含原 `lane`、`task`、`owner`、`admission` 与本次新的真实用户取消 `request`（messageId/roomId/authorId/严格递增 sequence）。根线程必须先核实用户明确取消该对象的指令；参数是来源记录，不是平台身份认证，不能编造授权。`取消`不等于任务完成、重试、暂停或清理源码。

- 仅接受已 `blocked` 且身份完全一致的原占槽任务；running、queued、completed、cancelled（除同事件读回）、未知身份均不放行。相同事件重放只读回原取消结果，不写新 revision、不再次检查/释放/派发；同事件换对象或换动作拒绝。
- 验证器由正式 CLI 固定调用，JSON 不能提交 `safe=true`、PID 列表或替代核查。原登记与 `registered` 启动意图必须一致。阻断准入期间，连续两轮查询当前主机完整进程、打开文件（包括 cwd 与 deleted-but-open 路径）及本地 Unix socket Docker context 的活容器归属（远端 SSH/TCP context 拒绝）；同时核对任务/owner 资源租约、最终 main 队列与保留的启动日志，前后登记与资源证据必须一致。检查权限不足、读取/解析失败、归属未知、残留锁、未封存的进程日志或任何活任务引用都拒绝，保留首次失败。
- 故意删除源码后的取消不要求恢复源目录，也不以目录消失或经过多少时间作为证明。使用保留的正式登记/启动意图与上述新鲜独立现况检查。验证解锁/重试所需的原 owner 证明不能通过取消补造；现存空锁不能删除或解释为已结束。原正式交付 session 仍存在时，本版本拒绝取消，因为仅本机扫描不能证明远端 CI 与运行交接已终止，应沿原执行者处理并提供准确阻点。
- 成功仅把该执行顺序 ticket 改为 `cancelled`，保留原 task/owner/admission/request/order、原因及全部历史，附本次取消来源与现况证据摘要。其他 ticket、两队列相对顺序、暂停开关不变；不会 claim、改优先级、恢复、派发下一项，不删除工作树、锁、registry、历史或数据。任务卡及通知仍由根线程按准确 ID/revision 更新。
- 作用域仍是已发布入口和本机受管工作流；不是任意低层命令、另一个主机或可写本地文件的独立安全边界。调用者必须从主线锚点而非待取消工作区运行。取消检查不启动服务、不读取密钥、不变更网络，不把成功取消称为开发/交付完成。真实环境权限审核继续有效；本候选测试全部使用隔离账本，不取消任何真实任务。

## 任务进展回执桥（417：工程工具与看板后端分离）

本节只规定接线，不改变 FIFO、准入、移卡和用户授权规则。旧版只补“等待执行/进行中”前缀的实现已替换：项目端不再决定 `status`、`current_work`、`next_step` 或移到哪张卡片。当前做什么、下一步做什么及移卡规则统一由看板后端处理。

### 已连接的工程事实

- `completion-session.mjs` 原持久保存成功后，采集本次真实 action 的 started/completed/blocked；首次开始和结束分别记录，不把 CI/main 单一步成功当正式完成。`progressNext` 是可选的显式下一步事实，不提供则明确“下一步确认”，不预测下一项。
- `task-execution-order.mjs` 原账本保存后采集真实 queued/blocked/paused。claim/admission 仅占位，不能生成“已开工”。
- 保存到同一仓库 `task-progress/<stable-task-id>/outbox.json`，每任务稳定回执 ID、递增序号。最多512条未确认，满时保留旧未确认项，明确输出同步告警，原工程记录仍保留；不丢弃旧待发送记录、不让看板故障改变工具成功/失败结果。
- 源保存与outbox保存不是跨文件事务；磁盘/锁异常时原事实还在，不宣称已同步。恢复时须从准确原事实补出同一 source key，不能重新运行开发、测试或交付来补看板。

### 单一回执契约

桥只发送 `apply_task_progress_receipt({id, revision, receipt})`，其中 receipt 为：

```json
{
  "version": 1,
  "task_id": "stable-task-id",
  "receipt_id": "durable-id",
  "sequence": 1,
  "observed_at": "2026-11-15T12:00:00.000Z",
  "action": { "id": "actual-action-id", "label": "修改处理逻辑" },
  "event": "started",
  "evidence_refs": ["exact-tool-receipt-reference"],
  "next": { "kind": "action", "label": "运行定向验证" }
}
```

`event` 为 queued/started/completed/blocked/paused；next.kind 为 action/wait/none。只有已有准确阶段完成证据才可带 `stage_fact:{kind,conditions,references,delivery_kind?}`，kind 为 development_ready/begin_delivery/delivery_complete，由看板原779规则判定，不让桥发送目标status。不以退出码、进程消失、文字推测补造完成证据。开发编辑等平台工具的每一步必须由持有该工具实际回执的编排宿主提供同样事件；代码不扫描聊天或猜测用户下一步。

### 认证宿主与回读

`authenticatedBoardAdapter(call)` 使用现有有权限的Dot工具调用，不包含网址、token或新服务。call 映射 `get_task_progress_receipt` 与 `apply_task_progress_receipt`；当前未发布对应工具时不得退回旧 update_task 绕过规则。CLI record/pending/prepare/acknowledge只读写私有回执文件，并不是远程写入已经执行。

先读回该 receipt_id；未找到才将首次观察的 revision 持久写入原 envelope，再发一次。无论返回成功或超时，都读取原回执并核对准确内容、任务ID、实际卡片/current_work/next_step及revision；确认后才移出pending。未知结果不得盲目重发，不刷新旧envelope的revision覆盖人工更新。每轮最多32个，失败停止本轮、不启动业务、不改队列；旧事实与新人工状态冲突时保留现场，需新的真实观察，不重新解释旧事件。

### 生产隔离与真实覆盖边界

这些模块仅位于 scripts 工程工具中，不修改 src、backend、生产API、启动服务、package依赖或生产配置。业务构建和运行不调用桥；生产没有看板、没有Dot连接、没有回执配置时不应因此报错。验收要检查真正构建产物中没有桥代码，不用目录命名代替证明。

现有仓库没有自动调用原生Dot插件的常驻宿主能力。原工程hook能自动生成本地事实，但平台编辑动作、显式下一步及自动远程发送仍需宿主接线；仅有隔离测试或生成outbox不能宣称“所有任务每一步已自动同步”。不为填补这条边界写生产业务代码、部署新服务、存凭据或扩大只读检测权限。

### 同进程宿主接线与交付互斥区

`createProgressHost(authenticatedBoardAdapter(call))` 仅接受已有认证宿主注入的函数；宿主用 `host.run(() => 原工程执行入口())` 包住既有执行。真实回执落盘后由 `setImmediate` 非阻塞触发一次同步，不等待网络再继续业务。`completion-flow` 在获取/持有正式交付 turn 的区间调用 transport hold，在原 queue.finish 后 finally release；此期间产生的通知仅积累，不发起新的看板同步。已开始的看板调用不进入交付 await 链；网络悬挂不能使主线交付槽不释放。

同步失败留下原待发回执，无自建轮询、服务、凭据或隐式业务重试。原宿主收到网络恢复信号时调用 `host.transportReady()`，只重新读回/同步同一批回执；`host.settled()` 仅供宿主在交付互斥区外等待同步结果或测试，禁止在protected turn内等待。宿主重启后可从准确已登记的 outbox 目录 notify 恢复，不扫描或接管其他任务。

这是可执行的同进程注入接口，不等于原生 Dot 已暴露该事件钩子；shell 子进程不会继承 AsyncLocalStorage。当前平台若只有分离的工具调用，不能把导出函数说成已经常驻自动接线，也不能为此窃取凭据或另建服务。已用原正式交付控制器+隔离真实队列+原CLI测试替身验收不阻塞及同回执恢复，实际平台接线仍必须如实说明。

### 每十分钟回放（417 当前选择）

用户已选择每十分钟由现有 Dot 定时宿主回放，取代“必须平台实时钩子才可执行”的前置要求。工程工具仍随实际动作落回执；不是每十分钟重跑工程任务，也不以十分钟没有回执认定任务卡住。同进程 runner 保持可复用，但无需部署新常驻程序。

宿主每轮先核对最新暂停/取消和已授权同步范围；仅处理明确登记的 stable task ID 与准确 outbox 目录，不凭看板编号或搜索结果自动关联。每个任务串行按 pending 顺序，最多32个；失败只停止该任务本轮同步，可继续其他已授权任务。Node CLI 不持凭据、不调用远端、不会启用任何计划。

用 `node scripts/task-delivery-status-sync-cli.mjs replay-plan input.json` 完成如下闭环，input 含 `{directory,task}`：

1. 首次返回 `get_task_progress_receipt` 的准确 operation。Dot 通过现有 owner-auth 看板工具执行，不能把普通任务文本当工具结果。
2. 将真实结构化工具结果作为 `readback`，再次执行 replay-plan。若 applied，则必须 exact receipt、applied_revision 及当前卡片/current_work/next_step 完整匹配，才持久 acknowledge；回执确认不代表新人工内容也等于旧内容。
3. 若 not_found，则首次持久冻结当前 revision，输出唯一 `apply_task_progress_receipt` operation。Dot仅发送这个envelope，不刷新旧revision、不自己生成展示内容或移动规则。
4. 发写成功也不得直接确认；无论成功、超时或结果不明，执行返回的 after 只读回执，再调用 replay-plan核验。发送失败可调用 `replay-error`，input加 `{receipt_id,code}` 持久分类错误，随后仍先读取回执；不能由“报错”推断一定没写入。
5. revision_conflict/stale_receipt/receipt_conflict/task_paused/invalid_receipt/forbidden等明确错误持续保留并返回needs-review，不每十分钟盲重试。若下一轮读到此前实际上已写入的完整回执，可正常确认；否则需要新的事实或正确授权，不改旧候选/队列。
6. 未知、读回失败、身份或内容不一致时保留pending；不启动、重跑、恢复、认领、调序或释放任何任务。确认或明确新阻碍才按通知约定报告；无变化静默。

上线前仍需：本代码通过交付并可由现有宿主读取；看板已发布新的apply/read receipt工具且owner身份通路可用；计划里登记准确任务/目录以及暂停与终止规则。缺一项只报告未接通，不声称全局自动生效。该候选已隔离验证真实CLI跨进程回放+实际看板后端，尚未创建计划或写真实看板。
