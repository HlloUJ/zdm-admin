# 普通开发任务的原执行者受控续接

## 边界

这是 284 的普通开发适配器，不替代正式交付执行器，不转移 owner，不安装常驻服务，不修改用户暂停任务。仅接受登记为 `developing`、尚未冻结、原 owner 仍可由根线程核验的任务。模块代码和隔离测试不等于自动唤醒、真实跨会话续接、Mac 重启恢复或通知已启用。

## 入口与根线程责任

1. 原 worker 调用 `createDevelopmentCheckpoint(root, {taskId, worker, rootThreadId, authorizationRef, nextStep})`。要求真实 `CODEX_THREAD_ID` 等于 registry owner，工作区干净；不可变快照绑定准确 HEAD、登记 revision、原 worker/root、授权引用、下一步和随机 nonce。
2. control 默认 `paused:true`。准确同任务获得执行授权后，原 owner 才调用 `setDevelopmentControl(root, {taskId, expectedRevision, paused:false, authorizationRef})`。revision CAS 冲突必须重读，不覆盖；暂停不代表进程已经停止。
3. 原 root 通过受支持平台能力独立确认原 worker 可达、空闲，先核清原执行结果与资源。提供短期 reachability 交接，绑定 `owner/worker/rootThreadId/checkpointId/head/nonce/receiptId/observedAt`，并带 `workerState:'idle'`、`interruptionConfirmed:true`、`effectsReconciled:true`、`resourcesResolved:true`。
4. 原 worker 调用 `runDevelopmentContinuation(root, {...绑定身份, reachability, execute})`。`execute({start})` 是当轮已授权逻辑，不是保存的 shell 自动重放。`start(command,args,options)` 仅允许一次监督执行入口，cwd 固定原任务工作区，复用原 supervisor/processScope。
5. 根线程须保留平台读取依据及授权出处。reachability 对象不是密码学身份证明，本地代码不能独立查询 native agent 树；仅传 `idle:true` 或复制 fixture 对象不能证明生产身份或授权。

## 排他与未知结果

- checkpoint 一次消费，任务级 active attempt 排他，防止提前建立多个 checkpoint 绕过正在执行或未知结果。
- 回调抛错、缺少真实启动、进程尚未结束、退出不成功或证据不足，保留 unknown 和现场；禁止因时间过去、进程 PID 不存在或新 checkpoint 自动重放。
- 只有原监督器退出成功、outcome 已落盘后才能释放准确自身 admission。结果 `completed` 只表示本次续接步骤完成，不代表任务完成或主线交付。
- 新控制 revision 在入口和 spawn 前复核。原 root 同时必须防止同任务其他执行入口竞争；本模块无法强制所有旧工具遵守其锁。

## 启动证明与通知

`readDevelopmentStart(root,{taskId,checkpointId})` 读取原持久 attempt、nonce、event token 以及 supervisor 在真实子进程 spawn 后写入的 journal，不使用预启动 running 标签代替证据。返回 started 只证明此次执行真正启动，不承诺当前仍活着。

候选已将 `binding.kind:'development'` 的读源接入共享通知模块。binding 需精确提供 taskId、checkpointId、owner、worker、rootThreadId、authorizationRef、taskNumber、taskName 和 roomId。ChatGPT 成功/失败通知复用 `task-recovery-notice.mjs` 的原 claim → beginSend → 根线程发送 → receipt 去重协议；隔离测试覆盖读源、错绑拒绝、真实启动时发送、同 attempt 完成后去重、失败原因待查及发送未知不重试；真实发送由协调者验证。本文件不声称周期调度或真实用户消息已启用。发送结果未知必须先核对，不自动重发；失败原因未查明时明确标“待查”。

## 隔离验收

定向 `node --test scripts/task-development-recovery.test.mjs` 使用临时 Git 仓库和原监督器，覆盖默认暂停、revision 冲突、错误 owner、脏工作区、错误或过期 reachability、unknown 不重放、新 checkpoint 不得绕过、同/不同 checkpoint 并发排他、真实 spawn 证明、执行未结束、暂停后禁止启动、没有监督执行不得算完成。测试不操作真实任务或预览，不更改系统安全配置。

剩余真实接入验收必须另行核实：原持久 root → 原 worker 可达、重启后原 worker 不可达时失败关闭、持久唤醒读取相同状态、通知准确投递与 receipt，以及旧普通开发入口的资源排他。不得把隔离通过当作上述场景已全部覆盖。
