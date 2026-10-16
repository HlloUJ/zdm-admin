---
name: zdm-admin-ui-conventions
description: 为装点猫管理后台新增页面、结构性改版、列表、表单、详情、弹窗或页面类型选择时使用。按登记的官方来源复用完整页面入口，维护客户试点及存量迁移边界；纯文案、局部样式和明确缺陷修复不使用。
---

# 官方 UI 整页复用

1. 读取项目 `docs/ui/standard.md` 与 `docs/ui/official-sources.json`，选择登记入口。新增普通列表查询区必须同时读取 `docs/ui/query-standard.md`，直接使用 `AdminListPage` 默认 `adaptive-grid`；不再重新解释列数和间距，不选择旧布局，不复制页面查询 CSS。官方模板及配套样式是视觉依据，现有业务页、旧 foundation 和外部 zdm-admin-ui 不是替代标准。
2. 通过 `@/components/foundation` 使用 `AdminListPage`、`AdminFormDialog`、`AdminDetailPage`；业务页只配置字段、列、权限过滤后的操作、数据、事件和单元格，不重复创建通用区域和分页。
3. 不能表达时先明确官方来源及缺口，组合登记为项目扩展，不称为完整官方模板；不擅自组合、恢复旧尺寸或添加视觉数值。
4. 2026-10-14已批准全项目仅视觉迁移。按 `docs/ui/visual-refactor.json` 逐文件冻结脚本与业务模板；既有页面可保留兼容入口和业务布局，仅统一官方视觉。新增页面仍使用登记入口。执行 `check:ui-templates` 及受影响独立参考/业务验证。

官方 Starter 和外部基座组件保持只读；说明文档仅在用户明确授权的范围维护。公共视觉只在项目唯一实现维护，反馈、上传、权限、接口和业务默认行为保留。来源目录见 [模板映射](references/template-map.md)。

控件占位文案统一遵守 [全局占位文案标准](../../../docs/ui/placeholder-standard.md)：输入框“请输入＋标题”，选择控件“请选择＋标题”；保留单位，不推断搜索范围。动态标题使用 `controlPlaceholder`，新增模块必须通过占位文案守卫。

查询组合搜索字段统一使用短标题和显式配置的完整范围提示（公共入口 `ListFilter.searchScope`），属于查询全局标准；普通字段规则不变。保留80px标签列和24px间距，不自动推断或扩展搜索能力。

列表标题与操作栏必须遵守 `docs/ui/list-standard.md`：不设展示型页顶标题栏；复用公共列表操作栏，既有日志右置，已选数量在左侧批量按钮后且仅有批量权限并选中大于0时显示。不新增日志功能，保留编辑导航及业务交互。

全系统界面字体遵守 `docs/ui/typography-standard.md`：直接使用官方完整字体变量，表单分区标题按官方基础表单18px常规字重，强调文字用mark变量；禁止新增硬编码字号、字重及行高。保留原生组件字体层级和商品富文本内容、编辑与预览排版。

表单分区间距、普通字段栅格、批量填写及上传外观遵守 `docs/ui/form-style-standard.md`，统一复用公共 `product-form-layout.css` 与 `AdminMediaUpload`；标题上24／下20px，普通字段24×32px，上传框110×110px。保持原有列数、全部业务事件及其他业务定制，不复制页面皮肤。
