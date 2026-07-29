# 本地启动与验收指南

本文件是开发环境、启动、验收、备份和回滚的唯一操作手册；其他工程文档只引用本文件，不复制命令。

## 环境要求

- Node.js 22
- Docker Desktop
- Google Chrome，用于本机 E2E 测试
- 可选：JDK 21、Maven。本机未安装时，后端可使用 Docker 运行。

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
npm run dev:all
```

该命令优先复用已有 MySQL 和后端容器，等待后端端口就绪后在当前终端启动前端。查看服务状态和手机可访问的局域网地址：

```bash
npm run dev:status
```

### 分开启动

```bash
docker compose up -d mysql
npm run backend:dev:docker
npm run dev
```

本机已安装 JDK 21 和 Maven 时，可将后端命令替换为 `npm run backend:dev`。

## 访问地址

- 前端管理后台：`http://127.0.0.1:5173`
- 后端健康检查：`http://127.0.0.1:8080/actuator/health`
- Swagger UI：`http://127.0.0.1:8080/swagger-ui.html`
- OpenAPI JSON：`http://127.0.0.1:8080/v3/api-docs`

## 登录账号

- 手机号：`15926626945`
- 开发验证码：`888888`

当前验证码未接入短信服务商，开发阶段由后端固定校验 `888888`。

## 常用验收命令

```bash
npm run quality
npm run build:app
npm run test:e2e:chrome
npm run backend:quality:docker
```

本机完整验收：

```bash
npm run verify:local
```

CI 完整验收：

```bash
npm run verify
```

说明：`backend:quality:docker` 会在 Maven 容器内执行测试、Checkstyle、SpotBugs 和 JaCoCo。本机 Maven 容器无法访问 Docker Desktop daemon 时，Testcontainers 集成测试会跳过；GitHub Actions 后端任务不限制测试类，会在宿主机 Maven 环境执行完整测试。

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

## GitHub 首次推送

当前本地仓库已经初始化并持续打 tag，`origin` 已绑定到：

```text
git@github.com:HlloUJ/zdm-admin.git
```

`main` 和所有 tags 已完成首次推送。后续正常提交后可直接执行：

```bash
git push
git push origin --tags
```

如果需要重新绑定到新的空仓库，可使用以下流程。

推荐仓库名：

```text
zdm-admin
```

创建空仓库后执行：

```bash
npm run github:publish -- git@github.com:<owner>/zdm-admin.git
```

或使用 HTTPS：

```bash
npm run github:publish -- https://github.com/<owner>/zdm-admin.git
```

脚本会完成：

- 检查当前工作区必须干净。
- 如果没有 `origin`，自动绑定远程仓库。
- 如果已有 `origin`，要求它必须和传入 URL 一致。
- 推送 `main` 分支。
- 推送所有 Git tags。

首次推送完成后，GitHub Actions 会按 `.github/workflows/quality.yml` 自动执行前后端质量门禁。
