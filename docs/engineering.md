# 装点猫管理后台工程化说明

## 当前工程结构

- 前端：Vue 3 + Vite + TDesign Vue Next + Vue Router。
- 后端：`backend/`，Spring Boot 3 + Spring Security + MyBatis-Plus + Flyway。
- 数据库：MySQL 8，本地通过 `docker-compose.yml` 启动。
- API 文档：后端启动后访问 `http://127.0.0.1:8080/swagger-ui.html`。

## 本地启动

1. 安装 JDK 21、Maven、Docker、Node.js 22。
2. 安装前端依赖：`npm install`。
3. 启动数据库：`docker compose up -d mysql`。
4. 启动后端：`npm run backend:dev`。
5. 启动前端：`npm run dev`。
6. 使用手机号 `13800000000`、验证码 `888888` 登录。

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

- 装点猫全模块核心定位与功能说明书：摘要显示各终端负责界面展示和前端交互逻辑，核心业务逻辑不应留在前端。
- 装点猫产品架构：摘要涉及门店日常运营管理。

当前环境未暴露 Notion 全文读取工具，因此后端字段和权限先按前端页面现状建立最小可运行模型。后续继续迁移商品、库存、板材、供应商等模块前，需要读取正式业务规则并校准字段、状态流转、角色权限和数据权限。
