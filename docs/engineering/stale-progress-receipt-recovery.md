# 过期回执的隔离与接续

旧离线事实先于用户手动更新时，417按manualBarrier拒绝stale_receipt。已部署v35只返回error/code，不返回retryable；项目既有终态表将stale_receipt标为不可盲重试。sequence只要求单调递增，不要求last+1；本实现不修改Site。

## 三种准确证据

| 路径                          | 必要证明                                                                                                                                  | 审计状态                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `recoverStaleReceipt`         | 认证宿主读取原操作、准确args和实际服务result；缺retryable时额外核固定v35契约及完整历史                                                    | `rejected-not-delivered`                                          |
| `recoverRecordedClientStale`  | 原已发布客户端entry中的stale_receipt终态记录、原宿主needs-attention文件及准确pending ID；新鲜认证历史独立证明已过时。保留文件完整字节/SHA | `client-reported-stale-not-delivered`，明确原提供方完整响应未保留 |
| `supersedeUnsubmittedReceipt` | 原entry从无prepare/revision/失败记录；实际deliveryStatus证明正式closed、准确main及正式回执digest；看板done且旧事实早于manualBarrier       | `superseded-without-submission`，不称服务器拒绝                   |

认证宿主通过authenticatedBoardAdapter调用现有get_task_progress_receipt/task_history。读取历史前后核对同一revision；v35 task_history无LIMIT，必须具备1至当前revision的完整唯一快照、正确task、当前字段一致、旧receipt_id从未应用，且原observed_at早于准确manualBarrier。历史不完整、revision变化、已应用、权限/冲突/网络或已prepare的未知写入继续阻断。当前完整服务器响应明确retryable:false的准确stale路径仍可直接用准确not_found读回证明；不把裸码冒充完整拒绝。

原entry、revision、sequence、观察时间均不修改。先在outbox/rejected/receipt_id.json持久保存原entry、原outbox完整字节和SHA、实际证据及当前读回，再原子移出pending；不进入acknowledged。先写审计后中断可重入，不覆盖已有审计。每条逐项核验，不按年龄批量丢弃。上述原owner进程/本地文件属于现有信任边界，不宣称独立防伪。

## 接续与当前状态

新事实仅来自当前准确阶段重新真实观察，使用独立receipt_id和真实时间；不刷新旧内容。CAS、用户手动屏障和原暂停保护继续有效。

638等已经正式完成的任务不再补新receipt。`readClosedDeliveryProgressSource(anchor,task)`只读取已有正式来源，不重跑CI/下载/交接。宿主再用`confirmCurrentBoardProjection`比较真实当前源与看板status/column/current_work/next_step，保存`current-state-confirmed-no-write`；不写看板、不声称历史receipt送达。

真实历史outbox仅由总协调在新main发布后按准确owner权限操作；隔离测试通过不代表生产638已恢复。

## 已证实的 invalid 流转缺口

`recoverTerminalInvalidWithSupersession` 仅处理原begin_delivery在原revision仍active而跳过review的这一类已确认缺口。必须有完整原客户端观察文件（准确entry、原failure invalid_receipt:false、源outbox、真实观察时间；原HTTP未保留时如实标注），当前已验证的修复就绪证据，以及认证的同revision完整history、manualBarrier和从未应用证明。权限/冲突/网络、其他invalid形状、无屏障或已应用均不套用。

原entry、payload、revision、observed_at、sequence及原失败完整保留，先持久审计再退出pending，状态固定为terminal-invalid-with-supersession；不改称stale，不记ack，也不把旧包刷新后重发。审计先写后中断可重入。普通flush不自动隔离invalid。宿主可显式传invalidSupersessions，每项绑定原receipt和clientEvidenceFile；修复源码发布及根明确恢复前不操作真实队列。

根清除action注记回原active后，后续未prepare/无failure的旧尾部仍保留原身份。既有flush首次实际发送，若服务确实拒绝stale才按真实code/history路径审计；不能直接把它们当已拒绝或送达。新的ready/begin只来自当前源的重新真实观察，并按卡片顺序逐次确认。

## 410 原始错误暂停回执

`correct-410-initial-pause` 是 039 发布的一次性纠正。旧主线 `153a1904` 在队列版本 121 将 410 的初始待绑定状态投影为暂停。实际受理、原生创建与绑定、独立工作区登记和开发准入均可读回。该回执序号为 1，原始客户端仍未 prepare。原开发票据处于运行中时核对它的有效 scope。票据已经正式完成时，保留原 admission 作为历史来源，核对原绑定、原方向及相符的完成事件、完成摘要和当前干净源码的原验证报告，且没有新的 410 scope、票据、调度预约或交付冻结。两种路径均受最新真实暂停围栏约束。

039 正式关闭且关闭提交属于当前主线后，由 410 原总协调在干净、已发布的主线运行 `node scripts/task-thread-host-bridge-cli.mjs`，沿已有隐藏 PTY 传 `action: "correct-410-initial-pause"` 和 `task: { taskId: "execution-efficiency-dynamic-orchestration", receiptId: "a7e0ad857d59341ed698b033d9f5d64652bc9204aee74193c4d2e19c8cfc99c0" }`。同次输入提供总协调原授权与 410 原生创建事件的最新 `nativeObservations`，以及 `progressNativeObservations` 中本任务完整 `task_history` 和四条原始回执的逐条 `get_task_progress_receipt` 原始工具结果。桥另读认证概览以核对当前版本。总协调按原客户端轨迹提供 `task.clientTransport`，其中 `outcome: "never-prepared-no-unknown-write"` 和 `outboxSha256` 绑定未投递判断和准确原始字节。任何手工或外部投递结果未知时应保留现场。准备记录、失败、未知传输字段、已应用回执、真实新暂停、证据过期或并发变化都会保留出箱并阻断。

成功时先落盘保存原始出箱字节、目标包序号与时间、首次错误来源及核对证据，再将序号 1 移入 `retired`，状态为 `retired-initial-pause-not-delivered`。序号 2 至 4 保留原样，由现有运输流程逐条读回和处理。保全后重复调用只读取核验过的归档。归档落盘后、出箱更新前中断，可在新鲜核对后接续。损坏或不匹配的归档保留待查。
