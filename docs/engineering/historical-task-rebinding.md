# 历史任务执行绑定与跨协调受理

仅用于用户明确授权的历史任务接管。原owner、监测、受理回执、队列请求、顺序、占位、冻结、失败和资源记录保留；新增 `executionBindings` 历史决定当前真实执行者。绑定不等于恢复、完成或正式交付，不启动预览、恢复日程或清理数据。

## 正式入口与真实来源

从干净且与origin/main一致的main锚点，以真实当前协调者身份运行 `node scripts/task-thread-host-bridge-cli.mjs`。入口自动应用已有HTTP_PROXY、HTTPS_PROXY、ALL_PROXY及NO_PROXY配置，相关Node子进程继承设置；显式NODE_USE_ENV_PROXY=0保留。Node 24使用原生接口，Node 22的fetch使用声明的工程依赖undici；无代理时不加载此依赖、不改变直连。不再逐任务手工添加启动参数。凭证只通过私有PTY输入，不进文件、参数和输出。候选仅在隔离测试中运行，发布前不得对真实任务执行新入口。

看板读回区分网络、代理/边缘访问策略、认证401、授权403、服务错误和响应不合法。错误只记录分类、HTTP状态及安全错误码，不输出凭证或响应正文。失败保留原受理、绑定和队列，不推断任务不存在、不自动重试创建或领取。

宿主实际调用原生read_thread，传入60秒内观察，不把原生创建事件改写成用户消息。`task.request` 始终指向真实用户消息的房间。与当前rootThreadId不同的房间，还须读回当前协调对话由该来源创建、包含原授权消息ID的原生create_thread事件。单独填写另一个房间ID不授予接管权。

新任务仍走receive、原生创建和标题读回、实际worker的start。v2回执额外保存sourceRoomId；不伪造旧root，不重建已登记任务。

## 当前协调者与长期排队

发布后，当前协调者以自身真实身份调用同一桥的 `action: "coordinate"`，task传rootThreadId、真实用户指定当前协调者的request及expectedRevision（首次0）。原生核对授权后，原子追加Git common dir下task-coordination/current.json的历史。改变协调者须同一用户的新指令和准确revision；重放只读回，冲突不改写。此操作不改任务owner、队列、暂停、预览或日程，不硬编码任何对话或任务ID。

此后receive、历史绑定及恢复只接受当前协调者。worker的start自动读取当前路由；原root、原生创建来源及授权房间仍是历史证据。监测回填提供当前协调者字段，通知只能由当前协调对话发送，不再要求旧root执行续证。

排队没有5分钟完成期限。真正start前，由实际worker核对原受理/原指令、原生创建和标题绑定、当前协调者来源、准确queued状态和暂停条件，再独立读回两次当前看板。任务须仍在active卡，编号及身份不变，两次revision和内容一致；网络/认证失败、取消、已启动、暂停限制、状态/身份变化或检查中版本变化均拒绝，不领取。

原回执超过5分钟或看板进度revision更新时，worker在受理锁内安全刷新observedAt与当前revision，保留owner、原授权、initialObservedAt、前回执摘要及实际续证者/协调者历史。它不调用receive、不创建任务/worker、不请求旧root代办。刷新成功后仍必须通过原5分钟有效期、实际容量、FIFO和准入校验；不靠扩大TTL或绕过门禁。队列或刷新失败保留原现场，相同请求再次核验，已经启动的任务不重放。

## 绑定

协调者使用 `action: "rebind"`，task包含准确工程taskId、新真实worker的owner、当前协调者rootThreadId、真实用户接管request（messageId、roomId、authorId、sequence），以及刚读回的expectedRevision（任务）、queueRevision和boardRevision。陈旧输入拒绝，不自动改基准重试。

工程ID与看板ID不同的旧载体保留原监测中的taskStableId；缺少原映射时须显式提供boardTaskId，worker的原生创建事件必须同时包含这两个ID。首次绑定后映射固定。672／134仍只绑定672这一名联合工程写入者，134保持只读，不产生第二份工程绑定或交付位。

执行须已暂停且没有有效单任务准入。旧执行者须能独立读回为idle/error；新旧worker同host；新worker须有由当前协调者创建且明确关联工程ID的原生事件，标题与当前看板一致。idle只证明平台状态，不能代替进程检查。

CLI独立执行两轮本机进程、打开文件（含cwd和删除后仍打开的文件）及本地Unix socket Docker容器观察。核对任务租约、保留锁、进程日志、冻结、正式session和main队列。任务引用、容器、任务或原owner租约、运行中正式阶段/main票据、未封存日志、未知及读取失败均拒绝。入口不会删锁、停进程、修复原session或释放占位；须先按原恢复保护处理具体阻点。

写入同时持有队列和registry元数据锁，再核对版本、资源证据及源码目录身份。只追加绑定、递增任务revision，不改队列。相同输入重放只读回当前绑定；换对象、换版本或被后续绑定取代的输入拒绝。旧执行者失去受管开发、预览、数据、准入和交付入口的写权限；普通registry.revise不能改绑定历史。

## 实际worker恢复

新worker以自身真实身份运行同一已发布桥，使用 `action: "resume"`，提供原绑定的taskId、owner、rootThreadId、request和准确kind，并补lane（development或delivery）及刚读回的taskRevision、queueRevision、boardRevision。开发需新鲜实际容量并预留交付位；交付须证明依赖已正式交付。

原票据可为queued、blocked，或暂停保护下仍保留占位的running。原请求和历史owner保留，为当前绑定记录独立准入事件并轮换token。同一真实用户指令可依次恢复多个明确绑定的任务，按准确绑定revision区分；不能更改全局暂停、顺序或其他任务。后续暂停撤销旧恢复指令。

开发恢复通过原start读取原Worktree，不fetch、不另建或覆盖；冻结任务必须走delivery。交付恢复仅返回准入token，不自动交付；实际worker以该token调用已发布 `task:entry --worktree <原目录> complete ...`，沿原冻结、失败、main队列、CI和交接继续。已恢复、有有效准入或启动结果未知时不重放resume。

内部队列、租约和冻结继续使用真实历史task.owner，运行身份单独核验。直接使用execution-order CLI操作绑定任务时，JSON明确包含原owner和当前executor。work、start、complete及预览使用当前真实执行者；旧owner或仅伪填参数均不能通过运行身份校验。

监测读取当前绑定，原监测保留；接管任务通知目标是当前协调对话，授权来源房间仍保留在上下文。入口不创建、启用或修改定时任务。

## 保护边界

这是本机受管工作流校验，不是针对可修改本地代码、账本或另一主机的独立安全边界，不能称为不可绕过。未知外部进程、活跃/损坏资源和证据缺失均保留，不按超时接管。

再次换执行者需要新的准确用户授权和完整检查，追加下一条绑定；不得删除历史来恢复旧owner权限。工程发布与回退继续正式交付保护，不能用旧脚本无视新绑定。业务、数据、媒体、备份及其他任务资产不在入口清理范围。
