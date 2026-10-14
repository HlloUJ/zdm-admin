---
name: zdm-admin-ui-conventions
description: 为装点猫管理后台新增页面、结构性改版、列表、表单、详情、弹窗或页面类型选择时使用。按登记的官方来源复用完整页面入口，维护客户试点及存量迁移边界；纯文案、局部样式和明确缺陷修复不使用。
---

# 官方 UI 整页复用

1. 读取项目 `docs/ui/standard.md` 与 `docs/ui/official-sources.json`，选择登记入口。官方模板及配套样式是视觉依据，现有业务页、旧 foundation 和外部 zdm-admin-ui 不是替代标准。
2. 通过 `@/components/foundation` 使用 `AdminListPage`、`AdminFormDialog`、`AdminDetailPage`；业务页只配置字段、列、权限过滤后的操作、数据、事件和单元格，不重复创建通用区域和分页。
3. 不能表达时先明确官方来源及缺口，组合登记为项目扩展，不称为完整官方模板；不擅自组合、恢复旧尺寸或添加视觉数值。
4. 2026-10-14已批准全项目仅视觉迁移。按 `docs/ui/visual-refactor.json` 逐文件冻结脚本与业务模板；既有页面可保留兼容入口和业务布局，仅统一官方视觉。新增页面仍使用登记入口。执行 `check:ui-templates` 及受影响独立参考/业务验证。

官方 Starter 和外部基座组件保持只读；说明文档仅在用户明确授权的范围维护。公共视觉只在项目唯一实现维护，反馈、上传、权限、接口和业务默认行为保留。来源目录见 [模板映射](references/template-map.md)。
