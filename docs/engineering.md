# 装点猫平台工程化说明

## 当前工程结构

- 管理后台前端：Vue 3 + Vite + TDesign Vue Next + Vue Router。
- 平台后端：`backend/`，Spring Boot 3 + Spring Security + MyBatis-Plus + Flyway。
- 数据库：MySQL 8，本地通过 `docker-compose.yml` 启动。
- API 文档：后端启动后访问 `http://127.0.0.1:8080/swagger-ui.html`。

## 平台化边界

- 后端定位为装点猫多端平台后端，不再是管理后台专属后端。
- Java 包名统一为 `com.zdm.platform`，后端 artifact 为 `zdm-platform-backend`。
- 管理后台接口使用 `/api/admin/**`；未来预留 `/api/customer/**`、`/api/designer/**`、`/api/guide/**`。
- 平台公共能力使用 `/api/open/**` 或 `/api/common/**`，具体边界在对应业务模块落地时确认。
- 核心业务逻辑沉到后端领域服务，各端只负责展示和前端交互。

## 本地启动

1. 安装 JDK 21、Maven、Docker、Node.js 22。
2. 安装前端依赖：`npm install`。
3. 启动数据库：`docker compose up -d mysql`。
4. 启动后端：`npm run backend:dev`。
5. 启动前端：`npm run dev`。
6. 使用手机号 `13800000000`、验证码 `888888` 登录管理后台。

## 质量检查

- 前端综合检查：`npm run quality`。
- 前端构建：`npm run build`。
- E2E 测试：先执行 `npm run test:e2e:install`，再执行 `npm run test:e2e`。
- 后端测试：`npm run backend:test`。
- 后端扩展检查：进入 `backend/` 后执行 `mvn checkstyle:check spotbugs:check jacoco:report`。

## 备份与回滚

- 数据库备份：`scripts/backup-db.sh`，默认输出到 `backups/`。
- 数据库恢复：`scripts/restore-db.sh backups/<file>.sql.gz`。
- 代码回滚：先用 Git tag 标记验收版本，例如 `git tag v0.1.0`；需要查看旧版本时执行 `scripts/rollback-code.sh v0.1.0`。
- 数据库结构变更必须新增 Flyway 迁移文件，不直接修改已执行迁移。

## Notion 依据与待复核

本次检索到的相关文档包括：

- 装点猫全模块核心定位与功能说明书：摘要显示各终端负责界面展示和前端交互逻辑，核心业务逻辑不应留在前端；不同角色登录后按权限展示菜单和数据。
- 装点猫产品架构：摘要涉及门店日常运营管理。

当前环境未暴露 Notion 全文读取工具，因此后端字段和权限先按前端页面现状建立最小可运行模型。后续继续迁移 C 端、设计师端、导购端、商品、库存、板材、供应商等模块前，需要读取正式业务规则并校准字段、状态流转、角色权限和数据权限。
