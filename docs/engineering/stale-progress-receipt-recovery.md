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
