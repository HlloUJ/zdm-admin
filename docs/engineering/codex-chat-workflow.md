# 普通 Codex 对话接入（337 候选）

## 状态与边界

本候选只在337独立工程工作区实施和隔离验证。没有启动原11项、修改真实FIFO、转移原owner、安装定时器或开启全局扫描。用户的启动例外仅允许337建立工作区，不是发布或真实队列例外入口。

任务总览稳定ID为`codex-chat-workflow-integration`，编号337；原生执行线程为`01a1e330-4080-7442-b39f-afdae005aca9`。普通任务正式使用本候选前须经原受信发布流程；不得直接用候选替换main锚点。

## 线程身份与开工

`task-monitor-registration.mjs`继续接受原`/root/...`子worker。普通线程显式传`executionSurface: 'codex-thread'`，`worker`为真实原生线程UUID，必须等于owner及运行时`CODEX_THREAD_ID`。未知surface、冒名线程或缺少通知字段均拒绝，不能给顶层线程编造子worker路径。

`task-codex-host.mjs`导出宿主适配函数。宿主通过已认证的平台工具传入`readTask`和`readThread`；不是从本地JSON或进程名推测身份。`codexMonitoringContext`要求读回准确未完成任务及编号，在根对话中读到准确原生`userMessage`，并核实执行线程。它只核实来源绑定，不代替宿主判断用户授权范围。

`startCodexTask`复用原FIFO，只领取已登记的准确队首。全局暂停、错误owner、错绑指令、非queued、重放启动均拒绝。领取后启动结果未知时保留原占位，不能再派发或启动别项来替代。宿主的`start`回调应通过已发布`task:entry start`执行，将返回的准确admission作为该子进程的`ZDM_EXECUTION_ADMISSION`，传递同一监测上下文；启动器继续完成registry及monitoring读回。领取不产生“实际启动”回执。

本模块不创建窗口，不调度新对话，不自动恢复或更换owner。新对话须有用户明确指令；已有任务接手仍须原写入方交接。

## 监测和通知

`inspectCodexTasks`要求准确任务ID白名单，从真实registry和FIFO读取暂停及排队状态。只查询名单中的原生线程，不隐式扫描旧任务。`observeCodexTask`通过宿主`readThread`读取最新原生状态：active/running代表平台仍在执行；idle、未加载、离线、错目录或证据缺失不能判成中断。明确的已结束错误轮次才形成失败观察；闭合任务和主动暂停不报警。交付命令的实际结果仍以原completion及CI证据为准。

通知复用`task-interruption-notice.mjs`的持久去重和投递读回。宿主提供授权的`sendMessage`和`readMessage`；发送到准确通知线程，返回的原生消息ID、实际正文和会话必须核实。旧观察超过60秒拒绝；发送结果未知留下claim，不盲目重发。通知正文不含业务恢复指令，也不调用任务执行工具。若平台只支持会触发新执行轮次的消息工具，宿主必须确保这是通知用途，未核实该能力前不启用。

没有安装或替换现有十分钟周期。候选没有常驻保证；要启用现有周期，必须另外核实其执行宿主可读取普通Codex线程、能加载已发布候选、能将通知送达准确对话。模拟投递不等于真实通知已送达。

## 工具回执与任务总览

复用417候选`5098f8f2b6b686e336e39833e5b11b122717ec41`的工程模块：`task-progress-outbox`、`task-progress-host`、`task-delivery-status-sync`、`task-progress-replay`及CLI和对应测试。只复制这些工程模块进入337候选，没有改写417原工作区或其Site候选，没有宣布417交付。

原`saveCompletion`及FIFO的持久写入之后捕获动作事实。捕获失败不改变原动作结果，既有失败保留。回执有稳定ID、单任务递增序号、原始证据引用；阶段事实只随明确证据发送，不从文案或PR绿灯猜测。开发工具可在实际动作保存后调用`recordCodexProgress`，不把启动器返回就绪当作业务开发已开始。

`syncCodexProgress`复用417同一协议，宿主必须提供`get_task_progress_receipt`与`apply_task_progress_receipt`。发送前读回、发送后再读回、CAS冲突保留、旧回执不覆盖新状态；总览更新失败仅补同步，不重跑业务。卡片进入条件继续由既有后端规则处理，宿主不改写规则。

当前普通对话可发现的UJ插件工具没有上述两个回执方法。只有`get_task_by_id`和普通`update_task`不能证明等价，不能伪造接口或将普通更新冒充自动流转。未接通时返回pending并保留本地outbox。这是正式启用前的外部能力缺口，不由隔离测试的模拟接口掩盖。

## 验证范围

隔离测试使用本任务目录中的独立夹具或独立临时Git仓库：原生线程身份、实际独立worktree及registry、未登记/错绑定拒绝、全局暂停、重复派发、启动失败持槽、active不误报、离线未知、告警去重及读回、真实completion回执、失联后补同步、缺回执接口时不虚报成功。已有FIFO容量与blocked持槽测试继续运行。

原真实队列及17个相关源码载体的HEAD、改动和未跟踪文件摘要，保存在337私有`.task-runtime/codex-chat-integration/protected-before.json`，末次核验与其比较。文件不入Git，不包含业务数据库或媒体内容。

以上不能替代普通宿主的真实周期、消息送达及总览自动流转验收。只有这些通道实际具备并验证后，才能报告“普通对话自动监测与同步已启用”。

## 2026-11-16 后续真实接入验证

用户随后明确只恢复417的回执接口发布，再继续337真实周期和通知验证；其他任务保持暂停。417原Site的5文件候选在独立副本组合到v31后发布为v32（`b913c705`），未改写原未提交资产。用户新增要求的正红色受阻标签另存`383d6f26`并发布v33，不改变原卡片或队列。417的管理后台候选尚未合入main，Site发布不等于整个417交付完成。

已使用337真实记录验证原协议：回执写入、精确读回、两个内容字段及原卡片一致；同一回执重复提交不写新revision，复用ID改变载荷被拒绝。当前插件工具元数据尚未暴露新方法，验证宿主通过同一已发布`/service/tasks`服务调用原协议，没有将普通update操作冒充回执。认证只使用Sites返回的现有owner-private凭据，经隐藏stdin传入，采用文档规定的`OAI-Sites-Authorization: Bearer`，未创建/轮换令牌或保存凭据。首次失败及修正记录保留。

真实普通对话仍附着main锚点，工具可在准确任务cwd执行。观察器只在最新原生轮次的最后一条实际命令绑定准确任务目录时接受这种情况；没有绑定或后来命令来自其他任务则返回unknown。对应负例及完整隔离工程回归已重新执行，不用旧报告覆盖新代码。

已通过原生Automation动作创建本对话的十分钟监测通道（ID `automation`），当前只允许观察337。配置存在及ACTIVE不代表实际周期或通知已通过，真实首次触发和消息投递必须另读原生回执；无实际触发不虚报。它不改变原FIFO，也不将旧Dot定时器默认为已迁移。私有验证状态与真实读回证据放在`.task-runtime/codex-chat-integration/`，不入Git。

## 独立监测通道的首次真实周期验收

对话内heartbeat在目标对话忙碌时，被平台以`Heartbeat thread is busy right now.`拒绝。用户明确选择独立定时监测后，通过原生Automation动作暂停原`automation`并保留，创建独立`automation-2`；名称为“任务执行状态监测”，每十分钟，使用当前默认gpt-6.1-sol/medium，绑定管理后台项目，仅观察337，不恢复其他任务。

2026-11-16北京时间16:41:11，原生调度记录产生独立运行`01a1e384-7737-72d3-9b53-bb016478f4e7`。观察器在父协调对话仍active/inProgress时读取成功，16:42:52完成并在Scheduled生成“337独立周期监测已触发”结果。父协调对话通过原生read_thread读回准确完成轮次及最终消息`msg_0b8d25c9807f99a9016afac209532c87d092b7b44d49f49575`，确认结果已投递到Scheduled。没有将本轮人工询问或旧通道的手动启动失败冒充周期执行。

最近聊天列表未列出这条定时运行，不能据此判定未触发。定位时只读查询应用调度存储中准确automation ID及run thread ID，再通过原生工具读回真实结果；不改写应用数据库。原生运行表没有单独的manual/timer来源字段，周期判断同时依据观察器获得的原生调度上下文、准确运行绑定及本轮未手动启动独立日程的事实，保留该限制。

原始独立观察记录与父侧消息读回保存在337私有目录的`independent-periodic-verification.json`和`independent-notification-readback.json`，旧失败保留。验收范围是337的首次独立周期和Scheduled消息送达，不代表系统推送或用户已读，也不证明旧11项、所有未来任务或连续多轮均已覆盖。其他任务、原排位及主线交付保持暂停；337源码仍是本地候选。
