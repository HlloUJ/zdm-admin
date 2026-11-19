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

正式新任务不再允许省略上下文：`execution-order claim` 对尚未登记的新开发项，在占位前验证 `monitorContext`；已发布 `task-entry start` 与实际 `task-start` 在创建工作区/资源前再次验证。缺失、格式错误、真实 owner 不符或任务错绑均拒绝，不能用占位字符串冒充真实来源。已有登记恢复不批量回填监测；底层 registry 保留历史和隔离测试兼容，不是正式新开工入口。宿主并不自动提供看板编号或 native worker 路径，本地文件不能冒充平台身份验证。根线程每次投递前仍须核对用户最新暂停指令、准确对象、原执行者及观察时效。

`monitoring.paused=false` 仅表示新任务登记时的初始状态，不证明用户此后未暂停；正式阶段 pause 记录和根线程当前用户暂停指令优先。正常完成、主动暂停、机器断线、未记录执行、模型推理中无本地进程均不得因此判定任务中断。

### 新任务开工读回门槛

根线程先从真实用户执行消息、任务总览已保存的任务及已分派的原 worker 获取上述字段，核验准确任务、owner、通知会话与授权，再向 claim 传 `monitorContext`，向 start 传相同 `--monitor-context`。正式 claim 将已验证上下文随原 admission 保存；通知会话和授权引用须等于原队列请求，start 核对同一 admission 绑定的全部上下文，不能换 worker 或通知对象。缺字段或来源不可核实则不 claim、不开工，不猜编号、worker 或授权。当前正式新任务 `taskStableId` 与登记 slug 一致；已登记历史接续保持原映射，不自动改写。

任务登记和 monitoring 在同一记录写入后，start 必须读回准确 id、owner、worktree、branch、revision 和完整 monitoring 并核对，才返回就绪并准备任务产物。写入/读回结果未知时保留现场，先 `registry resolve` 核对已保存记录、工作区与启动 intent；不重新 enqueue、claim 或新建任务，也不自动清锁。既有记录核实后沿原入口恢复，不重复创建分支/工作区。读回不成功不得派发实际开发。

这只是新任务登记门槛，不修改观察器、全局检测日程、暂停状态或旧任务覆盖范围；平台 worker 身份仍由根线程核验，登记成功不等于监测调度已运行。

## 普通对话受理门禁

原防漏规范要求的是收到执行指令后先登记、固定ID读回，然后才做任务核查。460只解决正式开工监测，不负责从对话中自动发现新任务；417的状态回执也不能发现完全未登记的工作。因此不能以监测或卡片接口已发布，推断受理规范已经在所有平台工具上强制生效。

普通对话宿主使用 `receiveCodexTask`：先核对原生用户消息，再按永久ID查询；只有明确不存在才创建。创建结果不算读回，必须独立读取任务并核对编号、标题、有效卡片、revision和归档状态。查询失败、错绑和结果不明拒绝核查/领位/开工，保留原状态。受理回执写入 git-common-dir/task-board-intake/<id>.json，先持久化再放行；新任务开工前五分钟内重新核对，过期只更新读回，不重建卡片。

`startCodexTask`、正式claim、development的resume-only，以及task-entry/task-start原生新开工读取相同回执。单任务例外必须持久携带已核对的monitorContext，避免先领位后丢失监测绑定。一次明确“执行本项、其他暂停”的原指令可以先pause-all、再resume-only同一项；其他动作或错绑重放仍拒绝，重复事件不改revision。

正式task-entry的registry register只允许核对已有登记，不允许新建任务绕过start。低层Git、直接模块导入和普通编辑器不受独立权限隔离；拥有本地写权限的人仍能改本地回执，所以它是程序一致性门禁，不是不可伪造的平台授权或全局工具沙箱。收到指令到进入宿主函数之前，必须由项目AGENTS和Git Skill限制为任务识别/查重，不得先做工程排查。不能声称纯仓库代码已经拦截全部普通对话工具。
