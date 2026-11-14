# 新任务监测登记（284）

## 范围

284 仅负责新任务登记、状态监测和 ChatGPT 告警，不负责自动续接。登记不会启动任务、解除暂停、转移 owner、重放命令或创建 PR/CI。原正式任务工具的执行与交付流程保持独立。

## 登记流程

1. 原 worker 保存准确的任务代码版本。`readEnrollmentSnapshot(root,{taskId})` 读取真实 registry、HEAD、工作区状态，以及固定目录中的策略、激活回执、绑定和原正式 completion 日志；不接受调用者提供的内容替代磁盘读取。
2. `requestContinuityEnrollment` 要求实际运行身份等于原 registry owner，工作区干净、HEAD 与登记一致，并提供准确 task/worker/root/授权引用/任务编号/名称/稳定 ID。已关闭或冻结任务不能按新任务登记。请求不可变，不从 owner UUID 猜 worker 身份。
3. 原 root 通过平台实际读取独立核实原 worker 身份及授权范围，再调用 `acceptContinuityEnrollment`。短期平台核验凭据绑定该请求、原 owner/root/worker、授权和完整快照。JSON 本身不证明云端身份。
4. 接受时重新核验完整 CAS 快照，并在排他下追加观察绑定。始终 `observationOnly=true`、`resumeAllowed=false`、`enrollmentScope='observe-only'`，不覆盖同一任务的既有绑定或改变暂停。不同正式任务载体可共享看板稳定 ID。
5. 重复成功接纳只核验持久回执及当前准确绑定，不新增记录。写入结果未知或遗留锁保留待核验，不擅自清锁、覆盖或重试。

登记锁只约束遵守同一协议的写者，不能声称它是所有本机工具之间的事务。新绑定不是自动执行授权，激活回执中的历史绑定摘要不等于永久冻结未来登记。

## 监测与告警

观察器读取原任务状态与执行证据。无变化保持静默；已证实异常或监测不可用时，由根线程向原 ChatGPT 对话告警，给出准确任务编号、名称、已查明原因。未知原因明确标“待查”，不能把 PID、缺日志或没有输出单独当成任务中断证明。

真实消息投递需持久去重与回执；结果未知先核对，不盲目重发。告警不是恢复成功，不暗中调用 worker 续接或原业务执行工具。登记模块本身不发送消息，也不安装或修改周期调度。

## 验证与限制

定向测试覆盖原身份与授权错绑、策略/绑定/日志/工作区快照变化、重复成功接纳、遗留锁、缺凭据和观察绑定不带执行能力。测试不依赖普通开发恢复模块，不修改真实任务或暂停状态。

候选代码通过测试不代表已发布或定时监督已启用。真实原 root/worker 平台可达性、监测周期和 ChatGPT 投递仍需实际核验；未经验证不能声称所有历史任务均已纳入监测。

## 真正新建入口接线

新任务 `task-entry start` 调用 registry.register 时同一记录原子写入 `monitoring`，不回填或批量关联旧任务。根线程创建看板任务并分派原 worker 后，将实际上下文传入 `--monitor-context '<JSON>'`：`taskNumber`、`taskName`、`taskStableId`、`worker`、`rootThreadId`、`roomId`、`authorizationRef`。原 worker 的真实 `CODEX_THREAD_ID` 必须等于 registry owner，字段缺失在创建工作区前拒绝。

兼容旧调用无上下文时登记为 `pending-context`，明确缺少准确通知条件，不声称覆盖；新任务编排路径应始终传入完整参数。宿主并不自动提供看板编号或 native worker 路径，本地文件不能冒充平台身份验证。根线程每次投递前仍须核对用户最新暂停指令、准确对象、原执行者及观察时效。

`monitoring.paused=false` 仅表示新任务登记时的初始状态，不证明用户此后未暂停；正式阶段 pause 记录和根线程当前用户暂停指令优先。正常完成、主动暂停、机器断线、未记录执行、模型推理中无本地进程均不得因此判定任务中断。
