# 装点猫平台工程约定

## 权威入口

- 开发运行、验收、备份与回滚：`docs/dev-setup.md`。
- 当前项目工程效率与质量门禁基线：`docs/project-optimization-baseline.md`。
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
- 小改动使用增量检查；高风险或跨模块变更使用 `npm run verify:local`。
- CI 入口为 `.github/workflows/quality.yml`，前后端完整门禁不得依赖文档中的人工提醒。

## 产品依据

工程文档不复制产品规则。跨系统设计先读取《装点猫产品架构》和《装点猫模块目录》；账号权限、菜单或具体业务规则读取对应有效原则或 PRD，草稿仅供参考，历史文档不作为当前实现依据。
