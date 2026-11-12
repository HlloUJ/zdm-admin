# 最小并行流程原生验收

本轮起始正式版本：e51b2e69f8c8d113ee10bc23a06aff762b66930c。验收记录：9112d300-81e5-416e-9924-85b2de7cacb8。

首次执行在停止 A 前因 5190 端口探测结果不可确认而停止，保留原始失败与前六项通过证据。该端口属于独立原型预览；原始底层 HTTP 状态或连接错误未留存，不推定具体原因。现场复核按原探测策略通过后恢复两个自有前端，以新 nonce 续接中断边界；未更改超时、忽略端口或停止原型服务。

后续验收脚本错误地假定拒绝占用端口前不会准备所属任务后端。原日志证明已有启动器先准备该任务后端；已纠正验收顺序，实际核验原端口、B 及数据保留，随后调用原停止入口并严格要求 A 后端停止。产品代码与原门禁未改动，此次失败及诊断继续保留。

验收使用系统终端、真实 Git、Docker、数据库账号及 HTTP 服务；未使用模拟依赖替代实际运行。此记录不表示受限助手执行通道已取得 Git 或 Docker 权限。

任务 B 已在任务 A 保持未提交、未完成且预览运行时独立交付。B 的 main：9f8944bc9110abcf8d70ef474bc79d667b66fdf5。

| 验收项                                  | 结果 |
| --------------------------------------- | ---- |
| native-execution-channel                | 通过 |
| two-private-task-environments           | 通过 |
| runtime-ready-is-not-quality-proof      | 通过 |
| independent-database-accounts-and-media | 通过 |
| stale-nonce-refusal                     | 通过 |
| a-api-failure-isolated-from-b           | 通过 |
| busy-port-preservation                  | 通过 |
| corrupt-registration-preservation       | 通过 |
| interrupted-update-preservation         | 通过 |
| interrupted-initialization-preservation | 通过 |
| permission-error-preservation           | 通过 |
| stop-and-restore-data-retention         | 通过 |
| foreign-api-consumer-refusal            | 通过 |
| b-delivered-while-a-unfinished          | 通过 |
| final-business-preservation             | 通过 |

上述检查已确认原业务源码、未提交成果、预览选择、数据库及媒体绑定保留。任务 B 已通过原交付门禁关闭；任务 A 携带本记录进入相同的正式交付流程，其关闭结果及两任务数据保留检查以本轮最终执行回执为准。完整原始证据保存在本次运行记录中。
