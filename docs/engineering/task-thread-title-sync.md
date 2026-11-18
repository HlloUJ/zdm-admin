# 任务看板与 Codex 子对话名称统一 V1

已登记任务在真实持续委托下的动态调度使用同一私有桥的 delegate/delivery-enroll/dispatch/dispatch-start/preparation-finish；身份、绑定、标题及原授权保持。入口及阶段副作用限制见[持续委托与动态任务调度](dynamic-task-dispatch.md)。新任务仍按本文正式受理，不用调度决定代替受理或原生创建证明。

明确授权的历史任务接管及跨协调来源兼容见[历史任务执行绑定](historical-task-rebinding.md)。它保留旧owner和原生创建历史；普通新任务流程不自动接管历史任务。

## 适用边界

仅正式发布并显式启用后的新任务使用本流程。任务名称由用户指定；看板生成当前编号；正式标题为`编号｜完整任务名称`。永久任务ID和真实原生子对话ID绑定，标题不是身份。完成后使用看板的`historical_task_number`字符串；它不参与活跃编号唯一性。总协调和全局任务状态监测保留功能名。

不盘点、改名或迁移历史任务，不转移已开工、已冻结或既有v1任务owner；不恢复任何暂停任务。387自身按原协调者加collaboration-agent方式交付，不用候选功能改造自身。

## 正式启用

发布前默认关闭，不因导入模块启用。main与origin/main一致、工作区干净，387准确main CI和运行交接已有成功证明后，在main运行`node scripts/task-thread-title-cli.mjs`，通过隐藏PTY传入`{"action":"activate","completionFile":"<387实际owner-private completion-session.json>"}`。脚本核对准确批次、最新CI对应main以及交接记录，再写入Git公共目录的`task-thread-titles/policy.json`。

启用后，`receiveCodexTask`和正式受理自动对无旧回执的新任务使用v2，不依赖调用者记得传模式。旧v1回执只兼容自身，不升级。普通Shell/编辑器和本地owner可修改的文件不构成独立防绕过保护，不宣称此机制能拦截所有平台操作。

## 普通对话实际工具桥

普通对话没有常驻JavaScript宿主，也不能在Node回调中调用MCP。实际入口是已发布main中的`node scripts/task-thread-host-bridge-cli.mjs`，一轮只执行一个有持久状态的步骤。隐藏PTY输入包含`action`、`task`、已认证看板`url/token`、当轮原生观察；凭证不得写参数、证据或源码。平台工具名字只描述宿主下一步，应按当前实际工具schema调用，不能照此编造网络API。

1. 总协调先确定永久ID，查重并通过真实看板工具创建“等待执行”记录，固定ID读回编号、完整名称和卡片。未受理前不查工程、不创建工作区、不派发。看板写入未知时先读回，不能盲目再次创建。桥会通过现有`get_task_progress_receipt`独立读取正式看板，`createBoardIntake.accept`完成持久受理和二次读回；桥不另造看板接口。
2. 用真实`read_thread`读取总协调的原指令，用平台实际容量读取形成容量快照；将结果原样包装后调用桥的`receive`。它自动选用v2，先固定FIFO待绑定票据并保留开发容量和交付预留位；容量不明、队首或暂停条件不满足时只返回排队。新任务明确允许局部启动时可传`startWhilePaused:true`，仅此新任务获准，其他暂停任务不变；未获得该授权不得传入。
3. 返回`nativeActions`中的`create_thread`只是创建计划，包含持久的`requestId/title/prompt`。宿主调用真实`create_thread`；不得把计划当作已创建。原始prompt必须完整保留，不自行改写。创建是异步的，只有`clientThreadId`时用真实`wait_threads/read_thread`等待准确ready threadId，并等初始等待轮次结束；不能拿clientThreadId当owner。
4. 再用`read_thread(includeOutputs:true)`读取真实子对话，输出长度须容纳完整创建事件。原生创建消息为`functionCallOutput`，要求`namespace=codex_app`、`name=create_thread`、`output.truncated=false`；完整`codex_delegation`的source_thread_id须等于原root，input须与持久creationPrompt及创建nonce精确一致。保留原始类型和正文，不合成userMessage，不凭preview或仅send_message_to_thread委托放行；缺少创建事件时按分页读取原始事件。旧userMessage路径继续兼容。把实际创建结果`creationResult:{requestId,threadId}`及总协调/子对话快照传入同一个`receive`。桥验证原指令、任务nonce、原生子对话ID和准确标题；原生平台仅附加一个末尾LF的已知边界兼容，CRLF、多个LF或正文差异拒绝。需要改名时返回`set_thread_title`计划，宿主真实执行并重新read，再续接。工具返回“成功”本身不能替代独立读回。
5. 只有未领位、未登记、同一原指令的新待绑定票据可以绑定实际worker，FIFO顺序不变。返回`awaiting-worker-start/workerInput`后，总协调先确认初始轮次已结束，再用真实`send_message_to_thread`把准确启动描述送给该worker；这不是开发已开始的证明。发送前保存发送意图，发送结果未知先查原生记录，不能盲目重发。注入式宿主可使用`store.dispatch`的持久去重；普通对话由宿主保全实际工具调用证据和消息ID。
6. 子对话以自己的真实`CODEX_THREAD_ID`运行已发布桥`start`，传原样workerInput、当轮root/worker观察和新容量快照。桥保留实际worker监测校验，再以准确admission调用已发布`task:entry start`，独立读回registry。总协调不能修改环境变量假扮子对话。领取不等于已启动；失败保留原开发位和错误证据，不换任务。

隐藏输入的核心结构（仅示意字段，不是可直接执行的真实证据）：

```json
{
  "action": "receive",
  "task": {
    "taskId": "永久ID",
    "title": "用户指定名称",
    "owner": "总协调真实UUID",
    "rootThreadId": "总协调真实UUID",
    "kind": "infrastructure",
    "request": { "messageId": "真实原指令ID", "roomId": "总协调真实UUID", "authorId": "实际用户", "sequence": 123 }
  },
  "nativeObservations": [
    {
      "provider": "codex-native-read_thread",
      "observedAt": "本次真实读取时间",
      "snapshot": { "thread": {}, "turns": [] }
    }
  ],
  "capacity": {
    "provider": "codex-native-capacity",
    "observedAt": "本次实际容量读取时间",
    "snapshot": { "limit": 4, "activeDevelopment": 0, "activeDelivery": 0, "activeOther": 0 }
  }
}
```

当前宿主工具未发现原生独立chat的全局并发容量查询；collaboration工具声明的4槽只适用于其agent池，不能拿来填写native容量。`codex-native-capacity`只是桥的内部观察标签，不是实际工具名；上方4槽是隔离结构示例，禁止直接用于真实任务。没有可证明的容量及活跃计数时，receive保持queued且不创建对话。若以后采用已发布的显式调度预算，须准确说明其来源和范围，不能称为平台硬上限；本任务不另建容量治理或自动猜测预算。

观察必须来自真实工具且不超过60秒。宿主包装不是平台签名或独立认证。创建或派发结果未知时保留意图、原始观察和容量预约，不自动释放、重建或换owner。恢复只根据原生真实证据继续。

## 正式改名与十分钟补偿

用户明确改名后，总协调先把正式名称更新到同一永久ID的看板记录并独立读回，再调用桥`rename`，提供实际改名指令和root观察。桥只同步已登记的真实子对话，失败保留pending，不创建新对话。注入式宿主的`store.rename`还提供看板未知写入持久意图，默认不盲目重复写。

现有十分钟监测复用，不新建日程：每轮用`task-thread-title-cli.mjs`隐藏输入`{"action":"list"}`，只枚举`task-thread-titles/tasks`下启用后的登记，不扫描历史聊天或看板存量。对bound任务调用`plan`（同一隐藏输入携带准确task、看板url/token），拿到准确threadId与expectedTitle；真实`read_thread`，不符才`set_thread_title`，随后再真实read；用`confirm`提交`observation:{provider:"codex-native-read_thread",observedAt,thread:{id,title}}`。confirm重新读当前看板，拒绝旧名称、错ID和过期观察，且不重跑任务或回执运输。未绑定或未知创建记录仅报告原阻点，不自动创建或派发。

`task-codex-cycle-cli.mjs`对本轮已经映射的新任务同时返回标题plan，需继续上述原生读回/confirm后才能报告该项标题同步完成；普通旧任务不追加标题请求。嵌入式宿主可向`syncCodexCycle`传入真实native适配器直接同步。没有新进展时，不刷新任务进展时间，也不改变卡片阶段。

## 验证与限制

隔离测试覆盖v1兼容、v2自动准入、FIFO、交付容量预留、真实worker身份、局部暂停保护、未知创建/派发不重放、精确标题、单LF契约、正式改名、完成历史编号、周期补偿及分步桥。隔离测试不创建真实样例任务或对话，不修改日程。

原生真实创建、改名与全链路启动须在发布后遇到合法新任务时由宿主验证；没有实际工具证据不得报告这些环节已通过。启用和监测提示更新由发布宿主完成，不用候选代码自证已上线。
