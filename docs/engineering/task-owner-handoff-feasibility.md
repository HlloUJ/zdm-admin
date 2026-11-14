# 284：单任务执行者交接可行性（隔离模型）

## 已证实的现状

一次性automation能读Mac上的challenge与事件，但其native agent清单中没有原worker；没有claim、发送或receipt。持久root读取可以关联原用户room及同一次automation，但同一root的持久会话并不保证旧native agent树可达。

现有task-registry的owner属于不可变身份字段；task-development与completion严格要求实际当前owner一致。已发布入口没有owner转交命令。此轮不改变这些保护。

## 最小交接条件

- 单一准确task、原owner、明确的新实际执行身份；任务授权和scope不扩大。
- 原任务revision、HEAD、工作区、分支、冻结快照精确匹配；保留所有首次失败和原证据。
- 原执行者由可信执行生命周期证明已经终止。仅在另一个清单里看不到、不在线、PID消失或超时均不够。
- 完整writer、pending tool、外部副作用和资源/队列核验；任何未知结果不自动重放。
- 所有参与写入的入口支持同一generation fence；在单任务独占/CAS事务里写入一次继任记录，原owner保持历史不变。
- 并发申请只有一个成功；原执行者后来出现必须被旧generation阻断，而非继续写入。

## 隔离测试

`task-owner-handoff-assessment.mjs`只是纯评估函数，无文件/网络/进程/registry写入口。即使模型条件齐全，固定返回`productionSupported=false`、`canApply=false`、`canReplay=false`，不能拿报告当授权凭据。测试里使用的证据标签是夹具，不是生产可信证明。

六项定向测试覆盖：完整模型仍不生效、当前native worker不可达必须阻断、活writer/待执行工具/未知副作用/租约/确认阻断、候选/身份/授权/时间漂移阻断、既有无generation fence阻断、内存CAS夹具只允许一次继任且保留originalOwner。未做真实registry修改、接管、常驻安装、安全设置变更或全量回归。

## 结论与缺口

**现有能力不能安全执行自动owner交接。** 当前缺少原native执行者跨上下文的权威终止证明，也没有覆盖现有任务写入口的generation fence。纯模型通过不证明这两项生产条件存在。

下一步若继续实现，必须先解决真实执行生命周期证据和所有写入口一致的代际保护，并通过受信发布；不能只把owner改成新ID，也不能只做一个本地锁文件冒充完全隔离。当前保留任务、原owner和证据，准确报告执行者不可达；可达原worker的任务仍按原流程继续，不因这个缺口停掉其他工作。
