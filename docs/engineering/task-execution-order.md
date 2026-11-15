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
