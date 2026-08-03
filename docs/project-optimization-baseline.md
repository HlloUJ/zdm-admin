# 管理后台项目优化基线

覆盖时间：2026-07-28 晚间至 2026-07-29
最后更新：2026-08-03

本文只记录 `/Users/uj/Documents/Codex/装点猫/管理后台` 的工程效率、开发环境和质量门禁优化。跨项目 Agent 规则、插件、Memory、通用 Skill 和 Token 策略不在本文维护。

## 项目优化边界

- 属于本项目：构建、测试、启动、Docker、Maven、CI、GitHub、项目 Skill 和项目验证数据。
- 不属于本项目：用户级 `AGENTS.md`、个人 Skill、全局插件、模型档位、跨项目知识治理和 Agent 通用方法。
- 产品原则、业务规则、页面功能和领域模型不作为项目基建成果记录。

## 已落地

### 项目上下文

- 项目级 `AGENTS.md` 只保留当前项目始终适用的 UI 约束和验证分级。
- 装点猫 UI 基座规则拆入 `zdm-admin-ui-conventions`。
- 装点猫 Notion 页面索引和状态过滤拆入 `zdm-product-knowledge`。
- 工程事实分别归入 `dev-setup.md`、`engineering.md`、`platform-architecture.md` 和 `api-contract.md`。

### 增量验证

- `check:changed` 根据本次任务文件选择类型检查、Lint、样式检查、相关单测和后端测试。
- 删除的 TypeScript、Vue 和 Java 文件仍能触发对应验证。
- ESLint、Stylelint 和 Vue 类型检查使用本地缓存。
- 中高风险任务保留相关测试或完整门禁。

### 本地开发

- `integration:dev` 始终从 `codex/integration-current` 固定 Worktree 启动完整项目，不随任务分支切换。
- `integration:status` 输出完整项目数据库、后端、前端状态和局域网地址。
- `dev:all` 和 `dev:status` 只用于明确需要隔离调试当前任务 Worktree 的场景。
- 后端容器启动时检查 `/workspace` 的实际挂载来源；Worktree 变化时自动重建后端容器，避免服务仍运行旧目录代码。
- Vite 监听 `0.0.0.0`，支持手机通过局域网访问。

### Maven 与 Testcontainers

- `backend:dev`、`backend:test`、`backend:quality` 默认使用 Docker，不依赖本机 JDK/Maven。
- 本机 Maven 只通过显式 `:local` 命令使用。
- 独立 `backend-tools` 容器复用 `zdm_maven_repo` 依赖缓存。
- 工具容器挂载 Docker Socket，Testcontainers 集成测试本地真实执行。
- `docker-java.properties` 兼容 Docker Desktop 29 的最低 API 要求。

### CI 与 GitHub

- 项目已绑定 GitHub 仓库 `HlloUJ/zdm-admin`。
- 前端 CI 执行质量检查、构建和 Chrome E2E。
- 后端 CI 执行完整测试、Checkstyle、SpotBugs 和 JaCoCo。
- 依赖漏洞扫描使用独立定时 Security Workflow。
- CI 使用缓存并取消同分支的过期运行。

### Git 与 Worktree

- 每轮明确改动在所属任务 Worktree 验证、提交并推送，同名本地与远程任务分支必须一致。
- `codex/integration-current` 持续汇总已推送任务分支，固定 Worktree 是日常浏览器和组合调试的唯一默认运行目录。
- `codex/acceptance-*` 只冻结准确候选清单；验收缺陷从验收使用的任务提交创建修复分支，不带入下一阶段开发。
- pre-commit 阻止在 `main`、集成分支和验收分支直接提交普通业务改动；这些分支只接受受控合并。

## 当前验证基线

| 项目             | 当前要求                                  |
| ---------------- | ----------------------------------------- |
| 脚本单测         | 覆盖增量检查规划及 Git/Worktree 状态机    |
| 前端门禁         | 类型、Lint、格式、单测、构建和 Chrome E2E |
| 后端门禁         | 测试、Checkstyle、SpotBugs 和 JaCoCo      |
| 任务分支交付     | 本地与同名远程 SHA 一致                   |
| 完整项目日常运行 | 固定集成 Worktree                         |
| 正式联合验收     | 冻结分支、独立 Worktree 和完整门禁        |

## 当前遗留

- `dev:status` 在受限沙箱中可能无法探测主机端口，需要增加进程和 Docker Compose 状态回退。
- Maven、Spring Boot、Playwright 成功日志仍偏长，需要默认摘要、失败时展开。
- 后端规模扩大后，所有 Java 改动执行完整测试会逐渐变慢，需要相关测试映射。
- 尚未形成不同项目任务类型的连续耗时、Token、工具调用和读取文件统计。
- 固定集成 Worktree 流程需要通过连续真实任务观察冲突恢复、后端重载和远程一致性。

## 下一轮项目优化

1. 修正 `dev:status` 的沙箱与主机状态探测。
2. 为 Maven、Spring Boot、Playwright 和 CI 增加成功摘要与失败日志展开。
3. 根据 Java 包、测试映射、配置和迁移文件选择编译、指定测试或完整测试。
4. 用连续真实任务验证任务推送、自动集成、固定运行目录和冻结验收。
5. 记录耗时、工具调用、读取文件和验证耗时，为跨项目度量提供样本。

## 复盘要求

- 先读取本文，不重新扫描全部项目工程文档。
- 只验证可能变化的脚本、配置、CI 和项目 Skill。
- 区分首次依赖下载和缓存后执行时间。
- 每项优化同时记录节省项、质量风险、回退方式和验证结果。
