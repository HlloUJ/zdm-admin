# 共享后台 UI 基座

本项目的新建或修改 PC 管理后台页面，必须接入并优先复用：
`/Users/uj/Documents/Codex/装点猫/管理后台原型基座/zdm-admin-ui`。

- 列表页自动匹配官方 TDesign Starter 的 `src/pages/list/filter`，优先使用项目内 `@/components/foundation` 导出的页面头部、列表结构和分页组件。
- 表单弹窗优先使用项目内 `@/components/foundation` 导出的 `AdminDialog`。
- 不得另建独立的页面间距、表格、分页或弹窗规范；旧页按需求逐步迁移。
