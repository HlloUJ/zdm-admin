# 未完成任务临时组合预览

本能力仅用于按需组合验收，不改变独立任务交付和最低并行标准。

## 边界

- 至少两个准确任务编号；只接受 developing、非暂停、非恢复阻断、非冻结的源任务。
- 捕获成员 HEAD、工作区内容树、登记版本。未提交内容使用私有临时 Git 索引，不提交、暂存、覆盖成员源码。
- 按明确成员顺序在 origin/main 上三方组合。任何冲突直接失败并列出冲突；不擅自取一方或修复业务。
- 专用载体从同一 main 基线新建，必须无既有改动和 checkpoint。写入前登记永久 previewOnly 标记，不能移除或改为普通任务。
- 组合不是正式交付候选；freeze 和 complete 入口拒绝。各成员仍分别验收交付。
- 使用载体自己的数据库、媒体、依赖、后端、前端端口。禁止共享成员数据库，禁止回退集成数据。
- 启动和数据准备前重新核对成员与组合内容。内容变化应建立新组合，不覆盖旧载体或已有数据。
- 不隐式启动服务、不切换 5173/5175、不清理源任务、数据或备份。失败保留载体和证据。

## 发布后入口

所有命令由助手执行，用户无需代跑。以下能力必须先经过审查及正式发布到 main；候选副本不冒充已发布能力。

1. 在干净 main 锚点执行 `npm run task:entry -- combination plan <成员A> <成员B>`，确认源、版本和冲突。
2. 用现有 `task:entry start --slug <全新组合编号> --kind infrastructure` 创建专用永久工作区。
3. 执行 `npm run task:entry -- combination apply <组合编号> <成员A> <成员B>`。重新快照并检查，再写入组合载体；返回不代表运行成功。
4. 对返回准确目录使用现有 `task:entry --worktree <目录> preview start --task <组合编号>`。按需指定未占用的独立端口。随后执行严格完整代理检查。
5. 用准确组合编号停止预览，保留其数据库和媒体。不得对组合执行“任务完成”。

不使用暂停任务作真实运行验收。先以独立验证任务证明组合、冲突拒绝、成员不变及隔离；未通过真实运行验收时明确标注尚未就绪。

## 新建任务的监测上下文

统一新建入口（包括 `task:entry start`、`task:start`、`task:micro`）要求准确 `--monitor-context '<JSON>'`，或仅为本次命令提供 `ZDM_TASK_MONITOR_CONTEXT`。JSON 必须含 `taskNumber`、`taskName`、`taskStableId`、`worker`、`rootThreadId`、`roomId`、`authorizationRef`；原 worker 的真实 `CODEX_THREAD_ID` 必须与 owner 一致。由根线程使用真实任务卡片与平台身份提供，不猜测或复制另一任务字段。

缺失、格式错误或身份不符时在任何 Git 修改前拒绝，不创建工作区。工作流模板调用可通过本次命令环境变量提供，不修改持久环境或受保护配置。已有任务的准确 resume 路径不要求补字段，也不会批量回填旧任务。底层 registry 的兼容登记仍可能明确显示 pending-context，不算统一新建监测已覆盖。
