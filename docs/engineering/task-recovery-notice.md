# 284 续接结果的 ChatGPT 通知

本模块是独立补充候选，不修改正在交付的恢复观察器，不启动任务、不更改 owner，也不调用消息服务。

## 证据与当前边界

生产入口 `readRecoveryNotice` 直接通过原任务登记读取原正式交付 session。必须有准确原 task/owner、原 interrupted 事件 ID、同阶段同 key 的后续独立 attempt、有效执行起止时间与 processTracking。不是调用者传入 `resumed=true` 即认可成功。纯 evaluator 供测试使用，不是生产证据接口。

新 attempt 成功结束证明真实重新执行过，才生成“编号｜名称：已成功续接。”；新 attempt 失败生成“编号｜名称：续接失败。”以及有证据的失败类别。没有具体根因时明确写“具体原因待查”，不推断资源不足、网络故障等原因。

及时启动通知采用原监督器的 post-spawn 证据，而不是 PID alive：根线程必须在续接前 `armRecoveryNotice`，生成随机 nonce 并记录 task/owner/worker/HEAD/原中断事件/阶段 key、已有 attempt 与 token。续接后独立读回 nonce 之后的新 attempt 及其引用的新 token；只有原 `completion-process` 在真实 child `spawn` 后写出的 owner-only `process-{token}.json` 状态 `started`，且 host/token/pgid 与原事件关联匹配，才生成成功续接通知。通知仅陈述已经发生重新启动，不声称进程此刻仍活着、不用 PID 存在作为证据。

没有 post-spawn 证明、nonce 过期或身份变动时不猜测，保守等待已完成的新阶段回执；旧 token、spawn 前 pending、仅 running 字段和普通验证器 `.started` 文件均不认可。没有原正式 session 的普通开发目前仍不支持即时通知。成功启动后同一 attempt 完成不会重复成功通知；若同一 attempt 随后失败，则是独立失败结果通知。

## 根线程接入

根线程提供经过实际任务映射核实的 binding：`taskId/taskNumber/taskName/owner/authorizationRef/interruptionEventId/roomId`。模块不能验证用户消息语义或判断任务名称映射，根线程必须先完成核验，不能从历史 nickname 猜编号。

0. 根线程先核实原 worker 与用户授权，调用 `armRecoveryNotice({root,binding})`；保存返回的新 binding（含 nonce）后才通过原入口续接。nonce 只绑定观察，不授权执行。
1. `claimRecoveryNotice({root,binding,directory})` 读取证据，独占持久 claim，仅返回事件 ID。已有 claim 时返回 reconcile-existing，禁止盲目重发。
2. 在实际发送前调用 `beginRecoveryNoticeSend({directory,eventId})`，重新读取全部证据，确认未变化且 claim 不超过两分钟。它先独占持久 send 记录，然后一次性返回原房间与消息文字。
3. 只有返回 send-once 时，根线程通过原 ChatGPT 消息工具发送。不能改发到新对话。
4. `recordRecoveryNoticeReceipt({directory,eventId,result})` 保存消息工具返回的准确 roomId/eventId/messageId。丢失、错房间或模糊回执保存为 unknown；先读回真实消息，不能再调用 send 重试。

同一原中断与新 attempt 的 outcome 去重；后续不同 attempt 独立通知。文件和父目录均 fsync。通知回执永远不代表任务完成。`dispatchRecoveryNotice` 只是上述步骤的单进程组合，供拥有异步传输回调的根线程使用。

测试使用临时 Git registry 与 session，不写真实任务、不发送消息、不制造业务中断。正式启用仍需发布门禁、原根线程集成与真实消息回执核验。
