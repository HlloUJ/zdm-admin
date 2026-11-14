# 284 续接结果的 ChatGPT 通知

本模块是独立补充候选，不修改正在交付的恢复观察器，不启动任务、不更改 owner，也不调用消息服务。

## 证据与当前边界

生产入口 `readRecoveryNotice` 直接通过原任务登记读取原正式交付 session。必须有准确原 task/owner、原 interrupted 事件 ID、同阶段同 key 的后续独立 attempt、有效执行起止时间与 processTracking。不是调用者传入 `resumed=true` 即认可成功。纯 evaluator 供测试使用，不是生产证据接口。

新 attempt 成功结束证明真实重新执行过，才生成“编号｜名称：已成功续接。”；新 attempt 失败生成“编号｜名称：续接失败。”以及有证据的失败类别。没有具体根因时明确写“具体原因待查”，不推断资源不足、网络故障等原因。

用户希望开始重新执行后及时通知。当前项目进程 journal 有 token/host/pgid 和子进程 spawn 后写入的 started，但没有可验证进程出生标识；PID 存在不能排除复用。为了不把 stale running/仅唤醒当恢复成功，本版本保守延迟到原阶段的成功回执。未实现即时 running 通知，不应宣称全覆盖。没有原 session 的普通开发仍不支持；原 owner 不一致、显式暂停、旧完成任务和缺失证据不生成成功通知。

## 根线程接入

根线程提供经过实际任务映射核实的 binding：`taskId/taskNumber/taskName/owner/authorizationRef/interruptionEventId/roomId`。模块不能验证用户消息语义或判断任务名称映射，根线程必须先完成核验，不能从历史 nickname 猜编号。

1. `claimRecoveryNotice({root,binding,directory})` 读取证据，独占持久 claim，仅返回事件 ID。已有 claim 时返回 reconcile-existing，禁止盲目重发。
2. 在实际发送前调用 `beginRecoveryNoticeSend({directory,eventId})`，重新读取全部证据，确认未变化且 claim 不超过两分钟。它先独占持久 send 记录，然后一次性返回原房间与消息文字。
3. 只有返回 send-once 时，根线程通过原 ChatGPT 消息工具发送。不能改发到新对话。
4. `recordRecoveryNoticeReceipt({directory,eventId,result})` 保存消息工具返回的准确 roomId/eventId/messageId。丢失、错房间或模糊回执保存为 unknown；先读回真实消息，不能再调用 send 重试。

同一原中断与新 attempt 的 outcome 去重；后续不同 attempt 独立通知。文件和父目录均 fsync。通知回执永远不代表任务完成。`dispatchRecoveryNotice` 只是上述步骤的单进程组合，供拥有异步传输回调的根线程使用。

测试使用临时 Git registry 与 session，不写真实任务、不发送消息、不制造业务中断。正式启用仍需发布门禁、原根线程集成与真实消息回执核验。
