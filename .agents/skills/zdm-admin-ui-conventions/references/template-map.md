# 管理后台模板映射

## 只读基座

- 业务 UI 基座：`/Users/uj/Documents/Codex/装点猫/管理后台原型基座/zdm-admin-ui`
- TDesign 官方模板：`/Users/uj/Documents/Codex/装点猫/管理后台原型基座/official-starter`

## 页面类型

- 首页 / 工作台：`src/pages/dashboard/base`
- 普通管理列表页：`src/pages/list/base`
- 带查询条件的管理页：`src/pages/list/filter`
- 左树右表页面：`src/pages/list/tree`
- 卡片列表页：`src/pages/list/card`
- 新增 / 编辑表单页：`src/pages/form/base`
- 分步骤表单页：`src/pages/form/step`
- 详情页：`src/pages/detail/base`
- 复杂详情页：`src/pages/detail/advanced`
- 登录页：`src/pages/login`
- 结果页 / 异常页：`src/pages/result`

## 项目入口与来源

权威登记见 `docs/ui/official-sources.json`。基础/筛选/Tab 列表用 `AdminListPage`，表单弹窗用 `AdminFormDialog`，普通详情用 `AdminDetailPage`。筛选列表完整实现在官方 `src/components/common-table/index.vue`。Tab + 官方网格查询 + 批量操作为项目组合，不称作原封不动官方整页。2026-10-14已批准全项目仅视觉迁移，存量页面按视觉重构契约保留兼容入口与原业务模板。外部 zdm-admin-ui 是旧版参考，不优先于登记的官方来源。
