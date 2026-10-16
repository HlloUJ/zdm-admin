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

新增普通列表查询区以 `docs/ui/query-standard.md` 为强制标准，使用 `AdminListPage` 默认 `adaptive-grid`；10:2分区、最多四列、24px垂直间距为已验收项目扩展。兼容旧布局只服务尚未迁移的现有页面。

列表标题与操作栏必须遵守 `docs/ui/list-standard.md`：不设展示型页顶标题栏；复用公共列表操作栏，既有日志右置，已选数量在左侧批量按钮后且仅有批量权限并选中大于0时显示。不新增日志功能，保留编辑导航及业务交互。

全系统界面字体遵守 `docs/ui/typography-standard.md`：直接使用官方完整字体变量，表单分区标题按官方基础表单18px常规字重，强调文字用mark变量；禁止新增硬编码字号、字重及行高。保留原生组件字体层级和商品富文本内容、编辑与预览排版。

表单分区间距、普通字段栅格、批量填写及上传外观遵守 `docs/ui/form-style-standard.md`，统一复用公共 `product-form-layout.css` 与 `AdminMediaUpload`；标题上24／下20px，普通字段24×32px，上传框110×110px。保持原有列数、全部业务事件及其他业务定制，不复制页面皮肤。
