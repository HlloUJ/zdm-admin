# 统一交付标准的工程映射

规范来源：[统一交付与验证标准 V1](https://app.notion.com/p/41a572fed032818fbae3eb9c2874092b)。执行配置为 `ci/delivery-standard.json`；本页只说明映射，不维护第二份分类算法。

## 计划、阶段和证据

`delivery-standard.mjs` 读取版本化配置，按最高风险和全部匹配要求的并集生成计划。普通源码路径、共享调用路径、敏感路径、执行规则文档及未知输入分别分类；局部样式不能覆盖共享或敏感规则。路径分类只是保守下限，不能证明业务语义、异步等特征不存在；现有业务契约、反向使用方和工程输入证明继续决定实际检查域，无法证明则保守完整回退。

| 标准职责              | 执行入口                                                   | 结果与保护                                                                                             |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| R0–R4、未知与混合改动 | `delivery-standard.mjs`、`verification-impact.mjs`         | 版本、配置摘要、规则、要求并集、保守影响域                                                             |
| 本地实际验证计划      | `verify.mjs`                                               | `.task-verification/plans/<digest>.json` 绑定源码内容、基线、平台与实际命令；不是检查通过证明          |
| CI适用域与计划核验    | `ci-quality-evidence.mjs` 的 scope/verifyScope             | 重新计算完整计划；旧配置、缺失计划和篡改均拒绝，不重解释历史报告                                       |
| 本地/PR/main分工      | `verification-policy.mjs`、既有 CI 与 `ci-equivalence.mjs` | 可靠CI承担最终候选适用门禁；高风险本地缺口不取消；main只使用已证明等价的原始完整报告                   |
| CI能力回退诊断        | `deliveryCiCapability`                                     | 记录 repository-identity/main-protection/quality-workflow 失败阶段；不保存潜在凭证错误正文，不削弱回退 |
| 执行/复用/失败        | 既有 verification-runner 与 performance                    | 保留首次失败、精确输入、实际环境、复用拒绝原因及执行墙钟                                               |
| 中断接续              | 既有 completion-session/flow                               | 只接续未完成或证据失效阶段；控制入口使用main锚点，不依赖待删除工作区                                   |
| 清理移交              | `build-task-app.mjs`、`task-cleanup-handoff.mjs`           | 创建时证明、稳定载体、持久化清单；定时消费由独立清理入口承担                                           |

计划不自动授权排除检查，不把风险等级当作执行成功。现有前后端必需汇总、来源冻结、首次CI、零跳过/零重试、运行交接均保留。现有分类器已经支持可靠CI轻量就绪，不能把历史耗时直接当作“无条件本地全套”的证据；优化需按本次回退与复用拒绝原因定位。

## 清理生产与生命周期接口

首期只接入由真实 Vite 成功构建、构建前后源码一致所登记的任务专属 `dist`。无创建登记、旧输出、修改过的输出、依赖树、失败日志、报告、数据及备份继续走原保护性保全，不凭目录名或年龄推断。`node_modules` 含软链接和潜在唯一内容，不能借本方案擅自清理。

构建 wrapper 不改变Vite参数或退出码。仅有准确 task-artifacts 登记时生成 `.task-runtime/cleanup-dist.json`。移交前核对源码摘要、对象身份及现有运行/预览引用保护；main CI、运行交接和正式来源检查仍由 settle 的前置步骤承担。

移交先持久化不可变重建证据与意图，再把同一文件系统的对象移到：

`git-common-dir/task-cleanup/staging/<永久任务ID>/<对象ID>/content`

原始 manifest 使用0600、wx；载体及目录0700。manifest v1固定 producer `task-completion-handoff-v1`，包含task、carrier、path、identity、proof、disposition、notBefore。`proof`绑定worktree、head、accepted、main及rebuild；rebuild指向稳定proof原始字节和SHA256，不是任意safe布尔。

`task-cleanup-queue.mjs` 为任务683提供的唯一消费者；生产端调用其 cleanupIdentity、cleanupObjectId 和 createCleanupQueue.handoff，不实现第二套身份算法。部署依赖顺序必须先具备该消费者，再启用新的构建登记入口。移交失败保留对象/意图并阻断收尾，不冒称已释放空间；消费者只在正式closeout及main读回通过、无引用且身份未变后删除。详细记录保留期和容量未获确认时不自动删除记录。

## 指定任务恢复与执行者观察

全局暂停时，`resume-selected` 仅恢复明确成员的开发准入，保留既有交付单例、其他票据状态及原收件顺序。准入要求真实原生用户请求身份、原owner/room、登记与监测上下文，以及一致的实际容量快照，始终预留一个交付位。未知容量、遗漏正在交付的占位、重复成员、跨owner、交付成员均拒绝。不得用本候选手改真实队列或把未发布能力称为已发布。

同一个原生聊天下的 collaboration 子执行者必须以真实canonical身份观察。父聊天活跃或最新一个command.cwd不能证明每个子执行者活跃；缺少canonical执行者观测适配时应为unknown，不能编造native threadId、套用Dot路径或自动释放/恢复。候选提供显式 `collaboration-agent` 登记和注入式 `readAgent` 接口；直接观测必须同时绑定canonical、准确task/owner/worktree及新鲜宿主快照。实时宿主尚未接线时保持unknown，不宣称已完成平台观察部署或独立权限隔离。

工程类型成员在明确恢复时同时绑定原恢复消息、永久任务ID、owner和工程kind。开发完成后，`execution-order promote-delivery` 读取准确registry并复核原开发报告、干净HEAD及其completion摘要，再用原授权引用创建派生交付准入；它不伪造另一条用户消息、不更新时间、不把原source重放成任意动作。新的pause会撤销尚未派生的资格，业务任务及缺证明任务拒绝。

派生仍须依赖准入和既定顺序，交付单独持位；已有交付或受阻持位不会被抢占，其他开发例外保留。重复派生只读回原票据，不旋转admission、不恢复blocked、不再次执行验证；最终main队列与共享资源互斥继续由原执行器承担。当前bootstrap载体仍须经已发布受理入口安排，不提供泛化adopt或直接import registry的绕过路径。
