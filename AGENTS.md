# 装点猫管理后台项目规则

## 项目边界

- 只修改当前项目；管理后台原型基座仅可只读参考，不得污染其文件。
- 保留已有和未提交改动，不回滚、不删除用户文件、不执行破坏性操作。
- 项目专属 UI 与 Notion 细节由 `.agents/skills` 按需加载，不在本文件重复维护。

## 始终适用

- 业务页面优先复用当前项目 `@/components/foundation`，不得另建页面间距、表格、分页或弹窗规范。
- 表单弹窗优先使用 `AdminDialog`；旧页面只在需求涉及处逐步迁移。
- 业务代码、接口和数据库规则以当前实现及有效产品文档为准，不从历史方案反推当前规则。

## 验证分级

- 后端启动和验证统一使用 `npm run backend:*` 命令，默认由 Docker 提供 JDK/Maven；不得因本机未安装 `mvn` 跳过后端验证。
- 纯文案、规则或脚本别名：检查 diff 和文件格式。
- 低风险样式、小交互：`npm run check:changed -- <本次文件>`。
- 中风险页面、表单、路由、服务层：变更文件检查加受影响单测或 E2E。
- 高风险登录、权限、API、后端、数据状态：相关前后端测试；边界不明时运行 `npm run check:full`。
- 发布、合并或高风险回归前：运行 `npm run verify` 或 `npm run verify:local`。

## Git 交付

- 稳定主分支为 `main`，任务分支默认使用 `codex/<task-slug>`。
- 任务分支验收前同步最新 `origin/main`；多个未合并任务联合验收时使用临时验收分支。
- `codex/acceptance-*` 仅用于合入任务分支和联合验收，禁止直接提交普通业务改动；pre-commit 会拦截。仅联合冲突修复可显式使用 `ZDM_ALLOW_ACCEPTANCE_INTEGRATION_COMMIT=1` 放行，并须在交付说明中记录原因。
- 稳定阶段成果通过对应分级验证后方可提交和推送；合并 `main` 前运行 `npm run verify` 或 `npm run verify:local`。
- 未经用户明确表示验收通过并允许合并，不合并 `main`；合并授权不等于生产发布授权。
