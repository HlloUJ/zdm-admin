# 装点猫平台工程化说明

## 当前工程结构

- 管理后台前端：Vue 3 + Vite + TDesign Vue Next + Vue Router。
- 平台后端：`backend/`，Spring Boot 3 + Spring Security + MyBatis-Plus + Flyway。
- 数据库：MySQL 8，本地通过 `docker-compose.yml` 启动。
- API 文档：后端启动后访问 `http://127.0.0.1:8080/swagger-ui.html`。

## 平台化边界

- 后端定位为装点猫多端平台后端，不再是管理后台专属后端。
- Java 包名统一为 `com.zdm.platform`，后端 artifact 为 `zdm-platform-backend`。
- 管理后台接口使用 `/api/admin/**`；未来预留 `/api/customer/**`、`/api/designer/**`、`/api/guide/**`、`/api/store/**`、`/api/factory/**`、`/api/installer/**`、`/api/supplier/**`。
- 平台公共能力使用 `/api/open/**` 或 `/api/common/**`，具体边界在对应业务模块落地时确认。
- 核心业务逻辑沉到后端领域服务，各端只负责展示和前端交互。
- 当前采用模块化单体，不拆微服务；包结构按平台业务中心组织，未来可按模块边界平滑拆分。

## 已落地后台模块

- 系统管理中心：租户、门店、角色、员工、统一账号、端身份、权限。
- 商品中心：商品分类、商品属性、属性标准值、基础资料。
- 库存中心：大板品种、大板库存、成品库存。
- 工艺中心：成品工艺。
- 供应商协同：供应商档案。
- 订单中心：平台订单最小模型，后续扩展销售单、生产单、安装单、售后单状态机。

## GitHub 设置

- Codex GitHub 插件：已安装并连接，可用于后续查看仓库、PR 和 GitHub Actions。
- 本地仓库：已初始化 Git。
- 远程仓库：已绑定 `origin` 到 `git@github.com:HlloUJ/zdm-admin.git`，`main` 和所有 tags 已完成首次推送。
- SSH 配置：本机已使用 `/Users/uj/.ssh/id_ed25519_github` 作为 GitHub 专用 key，普通 `git push` 可直接使用。
- GitHub App 安装范围：当前 Codex GitHub App 仍没有可访问仓库；如需 Codex 直接查看 Actions、PR 和仓库内容，需要在 GitHub 上为 `HlloUJ/zdm-admin` 安装/授权 GitHub App。

## 本地启动

完整本地启动、验收、备份与回滚步骤见 `docs/dev-setup.md`。

1. 安装 JDK 21、Maven、Docker、Node.js 22。
2. 安装前端依赖：`npm install`。
3. 启动数据库：`docker compose up -d mysql`。
4. 启动后端：`npm run backend:dev`。
5. 启动前端：`npm run dev`。
6. 使用手机号 `15926626945`、验证码 `888888` 登录管理后台。

如果本机未安装 JDK 21 或 Maven，可以使用 Docker 方式启动后端：

1. 启动 Docker Desktop。
2. 启动数据库和后端：`docker compose up backend`。
3. 另开终端启动前端：`npm run dev`。

## 质量检查

- 前端综合检查：`npm run quality`。
- 前端构建：`npm run build`。
- E2E 测试：CI 使用 `npm run test:e2e`；本机已安装 Chrome 时可使用 `npm run test:e2e:chrome`。
- 后端测试：`npm run backend:test`。
- 后端 Docker 质量检查：`npm run backend:quality:docker`。
- 本地一键验收：`npm run verify:local`。

## 备份与回滚

- 数据库备份：`scripts/backup-db.sh`，默认输出到 `backups/`。
- 数据库恢复：`scripts/restore-db.sh backups/<file>.sql.gz`。
- 代码回滚：先用 Git tag 标记验收版本，例如 `git tag v0.1.0`；需要查看旧版本时执行 `scripts/rollback-code.sh v0.1.0`。
- 数据库结构变更必须新增 Flyway 迁移文件，不直接修改已执行迁移。

## Notion 依据与待复核

本次检索到的相关文档包括：

- 装点猫产品架构：管理后台是统一内部管理入口，各端通过统一平台后端和中台 API 调用平台能力。
- 装点猫全模块核心定位与功能说明书：各终端只负责界面展示和前端交互，核心业务逻辑进入业务应用层/中台能力。
- 装点猫 2025 年度总结与 2026 年执行规划：2026 优先重构后台 ERP、全平台库存同步、供应链协同、订单全流程可视化。

当前后端字段和权限先按前端页面现状建立最小可运行模型。后续继续迁移 C 端、设计师端、导购端、商品、库存、板材、供应商等模块前，需要继续读取正式业务规则并校准字段、状态流转、角色权限和数据权限。
