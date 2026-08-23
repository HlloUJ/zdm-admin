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

### 集成环境

```bash
npm run integration:dev
```

该命令始终从 `codex/integration-current` 固定 Worktree 启动已经正式交付的组合版本，不在其中直接开发。集成前端固定使用 `5173`，集成后端使用 `8080`。

查看服务状态和手机可访问的局域网地址：

```bash
npm run integration:status
```

查看 Git、远程和集成状态：

```bash
npm run git:state
```

### 当前任务预览

macOS 首次在任一任务 Worktree 安装一次登录常驻服务：

```bash
npm run dev:task:install
```

以后切换任务时，只需在目标任务 Worktree 运行：

```bash
npm run dev:task
```

- `http://127.0.0.1:5175` 永远是统一预览入口；有任务时显示当前任务，无任务时自动回退到 `5173` 集成环境。
- 预览由当前用户的 `launchd` 托管，关闭终端不会停止；下次登录会恢复上次选择的任务。Docker Desktop 未运行时，守护服务会在后台启动并等待就绪，不依赖 Docker 自身的登录项。
- `npm run dev:task:status` 查看当前任务和进程，`npm run dev:task:logs -- --lines 200` 查看日志；更新守护脚本后重新运行一次 `dev:task:install` 即可原位升级。
- 纯前端任务复用集成后端；后端、API、Flyway 或运行配置任务启动该 Worktree 的任务后端。
- 两种模式都使用唯一的集成 MySQL 和 `zdm_admin`，所以 5175 手工验收产生的数据会永久保留并被后续任务复用。
- 常驻服务内部使用 `5176` 承载当前任务前端；只有并行对比时使用 `npm run dev:task -- --temporary`，该模式仍在当前终端前台运行，临时端口为 `5177-5199`；Playwright 固定使用 `5174`。
- `npm run dev:task:foreground` 仅用于调试启动器；日常验收不使用。
- `npm run dev:task:stop` 停止当前任务前后端并让 `5175` 回退到集成环境，不删除共享数据库或备份；再次运行 `npm run dev:task` 即可切换到新任务。

Flyway 迁移会自动检查其他共享数据库任务后端、暂停当前任务与集成后端、备份数据库并锁定任务切换；存在其他任务写入者时停止并报告，不会批量停止。非迁移但会批量删除、清空或破坏性导入数据时运行 `npm run dev:task -- --database-risk`。任务正式提交、推送并同步集成分支后运行：

```bash
npm run dev:task:handoff
```

该命令只有在集成分支已经包含任务提交且集成后端恢复健康时才释放数据库锁；备份仍保留，等待单独的清理确认。

集成数据库可能包含尚未进入 `main` 的迁移。启动器会把集成分支迁移和当前任务迁移合成临时只读目录供任务后端完整校验；同版本不同文件、同文件内容不一致、失败迁移或 checksum 异常都会停止启动，不会通过忽略规则绕过。

### 分开启动

```bash
docker compose up -d mysql
npm run backend:dev
npm run dev
```

本机已安装 JDK 21 和 Maven 时，可将后端命令替换为 `npm run backend:dev:local`。

## 访问地址

- 当前任务预览：`http://127.0.0.1:5175`
- 集成环境：`http://127.0.0.1:5173`
- Playwright：`http://127.0.0.1:5174`
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

- 普通集成后端代码调整可使用 `backend:restart`；任务中的后端或 Flyway 变化统一从任务 Worktree 运行 `dev:task`，不得绕过数据库备份与任务代码路由。
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

5173、5175、集成后端和任务后端共同使用这一套开发数据库，不创建任务数据库、不克隆数据，也不存在预览数据回写或双向同步。页面 E2E 使用接口 Mock，后端自动化测试使用 Testcontainers，两者不污染该数据库。MySQL 和集成后端容器使用 `restart: unless-stopped`；任务预览服务在登录后确保 Docker Desktop 启动，再由 Docker 恢复容器。当前任务前端由用户级 `launchd` 恢复，任务后端仍按代码改动按需启动，不常驻所有任务。

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
ZDM_CONFIRM_RESTORE=zdm_admin scripts/restore-db.sh backups/zdm_admin-YYYYmmdd-HHMMSS.sql.gz
```

恢复会覆盖当前开发数据，只能在用户明确确认后执行。脚本会优先使用正在运行的 Docker MySQL 容器；如果容器不存在，则回退到本机 `mysqldump` 或 `mysql` 命令。任务启动器生成的迁移前备份位于集成 Worktree 的 `backups/task-preview/`，不会在交付时自动删除。

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
