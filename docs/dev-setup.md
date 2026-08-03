# 本地启动与验收指南

本文件是开发环境、启动、验收、备份和回滚的唯一操作手册；其他工程文档只引用本文件，不复制命令。

## 环境要求

- Node.js 22
- Docker Desktop
- Google Chrome，用于本机 E2E 测试
- 后端开发与验证默认使用 Docker 中的 JDK 21、Maven，不要求本机安装。
- 可选：本机 JDK 21、Maven，仅在显式执行 `:local` 命令时使用。

## 首次准备

```bash
npm install
```

本机没有 Playwright Chromium 时，可执行：

```bash
npm run test:e2e:install
```

如果已安装 Google Chrome，本地 E2E 推荐使用：

```bash
npm run test:e2e:chrome
```

## 启动服务

### 推荐方式

```bash
npm run integration:dev
```

该命令始终从 `codex/integration-current` 对应的固定 Worktree 启动完整项目，与当前正在开发的任务分支无关。集成 Worktree 由 Agent 统一创建和更新，不在其中直接开发。

查看服务状态和手机可访问的局域网地址：

```bash
npm run integration:status
```

仅需要隔离调试当前任务分支时，才在当前 Worktree 使用 `npm run dev:all`。查看 Git、远程和集成状态：

```bash
npm run git:state
```

### 分开启动

```bash
docker compose up -d mysql
npm run backend:dev
npm run dev
```

本机已安装 JDK 21 和 Maven 时，可将后端命令替换为 `npm run backend:dev:local`。

## 访问地址

- 前端管理后台：`http://127.0.0.1:5173`
- 后端健康检查：`http://127.0.0.1:8080/actuator/health`
- Swagger UI：`http://127.0.0.1:8080/swagger-ui.html`
- OpenAPI JSON：`http://127.0.0.1:8080/v3/api-docs`

## 登录账号

- 手机号：`15926626945`
- 开发验证码：`888888`

当前验证码未接入短信服务商。本地 Docker Compose 通过
`ZDM_SECURITY_VERIFICATION_CODE=888888` 显式开启开发验证码，并通过
`ZDM_SECURITY_DEV_TOKENS_ENABLED=true` 为自动化测试保留开发令牌；应用默认值均为关闭或空值，部署到非开发环境时不得配置这两个开发开关。

## 常用验收命令

```bash
npm run quality
npm run build:app
npm run test:e2e:chrome
npm run backend:quality
```

本机完整验收：

```bash
npm run verify:local
```

CI 完整验收：

```bash
npm run verify
```

说明：`backend:test` 和 `backend:quality` 会在独立 Maven 工具容器内运行，并复用 `zdm_maven_repo` 依赖缓存。工具容器挂载 Docker Socket，Testcontainers 集成测试会在本地真实执行。只有 Docker Desktop 不可用时，后端验证才无法运行。

## 后端命令

```bash
npm run backend:compile
npm run backend:ensure
npm run backend:logs
npm run backend:restart
npm run backend:test
npm run backend:quality
```

- 后端代码或 Flyway 迁移调整后，使用 `backend:restart` 让现有开发服务重新编译并应用迁移。
- `backend:ensure` 会校验后端容器实际挂载的 Worktree；目录不匹配时自动从当前目录重建后端，完整验收会在 E2E 前自动执行。
- 日常后端改动使用 `backend:test`。
- 发布、合并或高风险回归使用 `backend:quality`。
- 本机已安装 JDK 21、Maven 时，可显式使用 `backend:test:local` 或 `backend:quality:local`。
- Agent 和项目脚本不得直接调用本机 `mvn`，统一通过上述 npm 命令执行。

## 数据库位置

本地数据库运行在 Docker 容器 `zdm-platform-mysql` 中，不会出现在 macOS 应用列表里。

- 数据库名：`zdm_admin`
- 用户名：`zdm_admin`
- 密码：`zdm_admin_pwd`
- 端口：`3306`
- 数据卷：`zdm-admin_zdm_platform_mysql`

查看容器：

```bash
docker ps --filter name=zdm-platform-mysql
```

进入 MySQL：

```bash
docker exec -it zdm-platform-mysql mysql -uzdm_admin -pzdm_admin_pwd zdm_admin
```

## 备份与恢复

备份当前数据库：

```bash
scripts/backup-db.sh
```

恢复数据库：

```bash
scripts/restore-db.sh backups/zdm_admin-YYYYmmdd-HHMMSS.sql.gz
```

脚本会优先使用正在运行的 Docker MySQL 容器；如果容器不存在，则回退到本机 `mysqldump` 或 `mysql` 命令。

## 代码回滚

查看版本标签：

```bash
git tag --list
```

切到某个验收版本：

```bash
scripts/rollback-code.sh v0.7.4-backend-api-smoke-gate
```

该脚本会进入 detached HEAD。需要继续修复时，先基于该版本创建分支。
