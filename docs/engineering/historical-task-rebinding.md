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

连续交接将两类来源分别验证：任务原指令保留原roomId及原root的创建溯源；当前协调者按`task-coordination/current.json`中已经真实核验并持久接受的独立任命request核验。因此A→B→C允许C由B创建，不要求伪造A直接创建C或把原业务指令替换成后续协调任命。每次任命仍要求同一真实用户的新指令、严格递增sequence、准确expectedRevision、当前协调者真实运行身份及对应来源房间的原生创建事件。排队worker自行续证，原受理owner、messageId和initialObservedAt不变，刷新历史记录实际worker和当前协调者。重复任命只读回当前聊天的原生任命来源；冲突、旧协调请求或未经接受的新授权均拒绝。已接受的任命不要求旧来源聊天以后一直可读：续行读取当前真实协调聊天及持久路由，不唤醒旧root。原任务来源返回新鲜原生明确not-found时，仅可按准确受理/队列/原生worker绑定或下述已登记项目状态证明续行；网络错误、来源矛盾及缺失载体仍拒绝。

排队没有5分钟完成期限。真正start前，由实际worker核对原受理/原指令、原生创建和标题绑定、当前协调者来源、准确queued状态和暂停条件，再独立读回两次当前看板。任务须仍在active卡，编号及身份不变，两次revision和内容一致；网络/认证失败、取消、已启动、暂停限制、状态/身份变化或检查中版本变化均拒绝，不领取。

原回执超过5分钟或看板进度revision更新时，worker在受理锁内安全刷新observedAt与当前revision，保留owner、原授权、initialObservedAt、前回执摘要及实际续证者/协调者历史。它不调用receive、不创建任务/worker、不请求旧root代办。刷新成功后仍必须通过原5分钟有效期、实际容量、FIFO和准入校验；不靠扩大TTL或绕过门禁。队列或刷新失败保留原现场，相同请求再次核验，已经启动的任务不重放。

### 排队任务跨协调续行

尚未登记工作区的v2任务使用`action: "continue-intake"`，保留原taskId、owner/rootThreadId、request及kind，另传当前真实`coordinatorThreadId`和同一用户明确恢复的`continuationRequest`。它复核原accepted回执、原FIFO票据、当前协调路由及两次一致的看板读回，只追加续行授权；不重新receive、不改变原顺序、不把创建聊天当开工。原任务若已登记则必须走历史绑定，不能退回本入口。

未创建、创建结果未知和已绑定worker分别继续原状态：仅未创建时按容量生成一次真实创建计划；未知结果沿原nonce和准确原生读回解析，不盲目重建；已绑定时返回同一worker。新创建来源单独保存`creationRootThreadId`，原受理root仍保持历史身份。后续历史绑定保留该真实创建来源，不误要求worker由最初root创建。

真实worker的start验证该续行、原回执/队列/原生绑定、当前协调者和当前看板，按准确`queued-native`引用授予本任务范围；新pause撤销旧续行，需要新的真实授权。其他任务新受理和非暂停事件不撤销已验证授权。kind改变、来源冲突、后来暂停、任务已注册或旧协调者调用均拒绝。排队超过回执时限时独立重验续证，不改变原owner、messageId或TTL。

receive、continue-intake及start返回时将实际等待创建、身份读回或已取得工作区的状态写入既有持久进度回执；稳定动作去重，沿正式传输和独立读回投影。排队事实不标记业务已开始或完成；容量等待、依赖等待、未知结果和真实阻点保持区别，失败不重跑创建/交付来填状态。

## 绑定

协调者使用 `action: "rebind"`，task包含准确工程taskId、新真实worker的owner、当前协调者rootThreadId、真实用户接管request（messageId、roomId、authorId、sequence），以及刚读回的expectedRevision（任务）、queueRevision和boardRevision。陈旧输入拒绝，不自动改基准重试。

工程ID与看板ID不同的旧载体保留原监测中的taskStableId；缺少原映射时须显式提供boardTaskId，worker的原生创建事件必须同时包含这两个ID。首次绑定后映射固定。672／134仍只绑定672这一名联合工程写入者，134保持只读，不产生第二份工程绑定或交付位。

执行须处于全局暂停保护下，且目标任务没有有效单任务准入；无关任务的准确准入原样保留。旧原生执行者须能独立读回为idle/error；新旧worker同host；新worker须有由当前协调者创建且明确关联工程ID的原生事件，标题与当前看板一致。idle只证明平台状态，不能代替进程检查。

首次接管旧协作执行面时，`executionSurface: collaboration-agent`或无该字段但worker为`/root/...`的原监测按历史协作记录核验，不把历史owner UUID伪装为原生聊天。默认路径保留原owner和worker路径，独立读回原monitoring.rootThreadId为同host的idle/error，再读回原roomId内authorizationRef对应的真实用户消息，并核对原正式start-intent的task、owner、worktree、branch、base和registered状态。绑定证据分别记录真实root、历史owner、worker路径和原授权摘要。历史聊天不可读时可使用下述项目状态恢复路径；普通网络错误、未知状态、跨host和来源冲突不能转换成恢复许可。已绑定任务再次接管仍核验当前执行绑定，不退回最初历史协作分支。

### 历史聊天不可读或未加载：接管持久项目状态

已有任务的历史聊天可读性与其项目资产归属分开。用户新的明确接管指令及当前协调者/新worker仍须完成真实原生核验；原任务的授权引用保存在原队列、登记、监测、开工及冻结中，保持原样，不伪称重新读到了旧用户消息。入口不需要旧root执行命令或续证，也不把not-found记成idle。

当前协调者可在同一已发布私有桥使用`action: "rebind-plan"`，task提供正常rebind所需准确身份和revision，并明确传`historicalRecovery: {mode: "preserved-project-state"}`。当轮额外的`unavailableNativeObservations`每项包含provider=`codex-native-read_thread`、真实被查询threadId、60秒内observedAt及原生工具原样result。只接受本机原生工具明确的`No Codex thread found ... local`结果；过期、错ID、网络错误、其他主机或同时出现可读快照均拒绝。旧协作记录查询其登记的root，缺原监测记录查询原owner；再次接管则查询当前绑定的真实执行者。

历史原生聊天可读但状态为`notLoaded`时，仍使用上述显式项目状态路径，提供正常`nativeObservations`，不制造not-found。仅接受准确旧执行者（历史协作则为原root）、本机local host、无其他运行标志的`{type: "notLoaded"}`；已返回回合若带状态，只能为completed/interrupted/failed。普通绑定仍拒绝notLoaded，active、未知回合、跨host和额外运行标志继续拒绝。[官方thread/read说明](https://learn.chatgpt.com/docs/app-server#read-a-stored-thread-without-resuming)表明读取不加载或恢复聊天；notLoaded只描述服务内存状态，不能单独证明旧执行已停止。因此本分支必须通过同一原载体/授权/冻结/全源码摘要、双轮本机进程/打开文件/Docker及旧执行者引用核验，计划返回`native-not-loaded`，证据保留原状态和原生观察摘要，不改记idle。它不调用thread/resume、不发消息或唤醒旧root。

真正绑定必须携带计划的准确historicalRecovery.digest；原生可用状态已变化时拒绝，不静默降级为普通绑定，须按新观察重新审查计划。上述证明仍只覆盖当前本机受管工作流，不宣称另一服务或主机没有远程执行器。

只读计划完整核对原任务登记及本仓库Worktree/Git归属、同一真实用户的原队列指令、原registered start-intent；缺start-intent的冻结载体则核对原accepted-source及Git对象/消息摘要，不创建或重建冻结。原监测缺失时明确记录historical-unclassified，不编造root或执行面。计划摘要包含原登记、原票据、开工/冻结来源、HEAD、索引及所有跟踪/非忽略未跟踪源码的内容与删除状态；数据环境登记、保留锁、正式session、进程日志和main占位仍按原保护检查。两轮完整本机进程、打开文件、Docker及历史执行者引用检查均须通过，前后源码和资源证据一致。

计划只返回`ready-to-bind`（binding-only）、准确task/board/worker/revision及historicalRecoveryDigest；这不表示可开发、已恢复、容量已分配或数据已启动。真正`rebind`须重新提供新鲜原生观察及同一historicalRecovery.digest，并再次检查；摘要、版本、源码或资源改变一律拒绝，不自动改基准。只有目标任务没有有效scoped admission才可绑定，不阻塞无关任务的准确准入。新绑定保留historicalOwner、历史来源及不可读证据，另记新的实际接管授权和projectSourceDigest。其后由真实worker走原resume入口核验数据、依赖、容量/FIFO，得到准入后才执行原工作；恢复等待和失败不得冒充启动成功。

未冻结且没有原正式开工载体、冻结对象缺失、原授权归属冲突、仍有旧写入、远程/未知资源或平台无法明确返回上述原生结果时继续保护性拒绝，保留全部原资产并报告具体恢复入口。仅有runtime=false、用户新指令或本地not-found文字不能单独放行。本机可改文件与宿主包装不是独立安全边界，不声称证明了远程执行器不存在。

CLI独立执行两轮本机进程、打开文件（含cwd和删除后仍打开的文件）及本地Unix socket Docker容器观察。核对任务租约、保留锁、进程日志、冻结、正式session和main队列。任务引用、容器、任务或原owner租约、运行中正式阶段/main票据、未封存日志、未知及读取失败均拒绝。入口不会删锁、停进程、修复原session或释放占位；须先按原恢复保护处理具体阻点。

既有node_modules依赖目录不参与日志遍历；历史node_modules符号链接只按链接身份记录并保留，不跟随、不修改目标，不作为业务源码来源。其他运行目录链接继续拒绝；跟踪或非忽略业务源码中的链接不因该依赖例外放行。

`process-<UUID>.json`按文件token、记录token、host、PGID及quiescent状态核验；正式session中每条process引用须有对应原日志，session存在时不接受无引用日志。其他`process-*.json`只有不含token/host/pgid/status启动字段，且具有scope、40位baseCheckpoint、完整非负整数测试计数及static/production对象的测试报告才单独识别，原文仍纳入稳定性摘要，不改名、不删除、不补封存状态。损坏JSON、未知记录、改名日志、未封存或结构错误日志继续拒绝；不按测试通过数推断进程已退出，也不以当前host名称覆盖历史封存host。

写入同时持有队列和registry元数据锁，再核对版本、资源证据及源码目录身份。只追加绑定、递增任务revision，不改队列。相同输入重放只读回当前绑定；换对象、换版本或被后续绑定取代的输入拒绝。旧执行者失去受管开发、预览、数据、准入和交付入口的写权限；普通registry.revise不能改绑定历史。

## 实际worker恢复

新worker以自身真实身份运行同一已发布桥，使用 `action: "resume"`，提供原绑定的taskId、owner、rootThreadId、request和准确kind，并补lane（development或delivery）及刚读回的taskRevision、queueRevision、boardRevision。开发需新鲜实际容量并预留交付位；交付须证明依赖已正式交付。

原票据可为queued、blocked，或暂停保护下仍保留占位的running。原请求和历史owner保留，为当前绑定记录独立准入事件并轮换token。同一真实用户指令可依次恢复多个明确绑定的任务，按准确绑定revision区分；不能更改全局暂停、顺序或其他任务。后续暂停撤销旧恢复指令。

排队期间其他任务的新受理或非暂停配置事件不撤销已核实的准确绑定授权；受管入口仍要求当前真实worker、原绑定request及revision、当前协调者路由、最新队列revision和未被新pause撤销。它不能授权全局变更或其他任务。真正领取前再次检查双轮本机进程/打开文件/容器、资源和任务版本；项目状态恢复路径还核对绑定时的源码内容摘要，变化时保全并要求重新审查绑定。登记依赖未正式交付或容量不足时不领位、不启动，保留等待原因；领取后启动失败继续保留原位置和首次失败。

开发恢复通过原start读取原Worktree，不fetch、不另建或覆盖；冻结任务必须走delivery。交付恢复仅返回准入token，不自动交付；实际worker以该token调用已发布 `task:entry --worktree <原目录> complete ...`，沿原冻结、失败、main队列、CI和交接继续。已恢复、有有效准入或启动结果未知时不重放resume。

内部队列、租约和冻结继续使用真实历史task.owner，运行身份单独核验。直接使用execution-order CLI操作绑定任务时，JSON明确包含原owner和当前executor。work、start、complete及预览使用当前真实执行者；旧owner或仅伪填参数均不能通过运行身份校验。

监测读取当前绑定，原监测保留；接管任务通知目标是当前协调对话，授权来源房间仍保留在上下文。入口不创建、启用或修改定时任务。

## 保护边界

这是本机受管工作流校验，不是针对可修改本地代码、账本或另一主机的独立安全边界，不能称为不可绕过。未知外部进程、活跃/损坏资源和证据缺失均保留，不按超时接管。

再次换执行者需要新的准确用户授权和完整检查，追加下一条绑定；不得删除历史来恢复旧owner权限。工程发布与回退继续正式交付保护，不能用旧脚本无视新绑定。业务、数据、媒体、备份及其他任务资产不在入口清理范围。
