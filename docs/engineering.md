# 装点猫平台工程约定

## 权威入口

- 开发运行、验收、备份与回滚：`docs/dev-setup.md`。
- 当前项目工程效率与质量门禁基线：`docs/project-optimization-baseline.md`。
- 产品架构最终图及文档索引：`docs/product-architecture.md`。
- 技术分层和模块边界：`docs/platform-architecture.md`。
- HTTP 接口事实：Swagger、Flyway 迁移及 `docs/api-contract.md`。
- 产品语义、系统边界、模块职责和权限规则：Notion 中状态为“有效”的对应文档。

## 工程结构

- 前端：Vue 3、Vite、TDesign Vue Next、Vue Router。
- 后端：`backend/`，Spring Boot 3、Spring Security、MyBatis-Plus、Flyway。
- 数据库：MySQL 8，本地使用 Docker Compose。
- 当前采用模块化单体，按平台业务中心组织，不提前拆分微服务。

## 开发约定

- 管理后台接口使用 `/api/admin/**`，公共能力使用 `/api/open/**` 或 `/api/common/**`。
- 端侧 Controller 只处理入参、鉴权和 DTO，核心规则进入可复用领域服务。
- 数据库结构变更只新增 Flyway 迁移，不修改已经执行的迁移。
- 前端优先复用 `@/components/foundation` 和项目现有模式。
- 增量验证必须显式传入本次任务文件：`npm run check:changed -- <files>`。

## Git 与质量

- 保留未提交改动，不在任务中混入无关格式化或重构。
- 同仓库串行模块按批次共用分支、Worktree 和预览；模块分别验证并保存本地提交，整批“任务完成”时统一推送与合并。新对话通过 `task:batch status` 恢复目录；模块依赖、局部回滚与清理按 [批次开发规则](project-optimization-baseline.md#批次连续开发) 执行，不默认压缩模块提交。
- 开发使用增量检查，普通交付使用 `npm run verify:delivery`；高风险需要本地完整回归或 CI 基础设施不可用时使用 `npm run verify:local`。本地通过不能覆盖 CI 真实失败或绕过分支保护。证据失效和强制重验按 [工程效率基线](project-optimization-baseline.md#验证证据与执行) 执行。
- CI 入口为 `.github/workflows/quality.yml`，最终候选按完整差异选择全部适用门禁；`Frontend quality` 和 `Backend quality` 始终汇总，分类不明时执行全量，不能靠文档提醒或工作流路径跳过。

## 产品依据

工程文档不复制产品规则。跨系统设计先读取《装点猫产品架构》和《装点猫模块目录》；涉及供货路径、销售承接或总览图未展开的协作时，同时读取《装点猫架构协同关系与供货场景》。账号权限、菜单或具体业务规则读取对应有效原则或 PRD，草稿仅供参考，历史文档不作为当前实现依据。
