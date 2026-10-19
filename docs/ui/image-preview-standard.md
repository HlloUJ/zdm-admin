# 图片预览全局标准

确认：2026-10-19。后续各业务端新增或调整普通图片预览时统一遵守。本标准采用 TDesign 官方弹窗及公开属性，是项目统一组合约定，不冒称官方唯一的图片预览方案。

## 统一实现

- 复用 `@/components/foundation` 导出的 `AdminDialog`，底层为官方 `t-dialog`；内容使用原生 `img`。以门店成品现货、客户管理已确认的实现为依据。
- 显式设置 `mode="modal"`、`show-overlay`、`close-on-overlay-click`。遮罩的渲染、外观、层级协调及外围点击关闭由 Dialog 原生负责。
- 统一窗口宽度为 `min(960px, 94vw)`，位置沿用公共弹窗的居中设置；图片保持原比例，仅通过 `max-width: 100%` 限制不超出内容区，不裁切或拉伸。
- 保留原生右上角关闭按钮及 ESC 关闭，隐藏底部操作栏。标题和图片替代文本沿用业务含义，不统一改名。
- 不新增窗口／遮罩皮肤、深度选择器或全局覆盖；不手工拼接 `t-image-viewer__*` 等组件内部样式类，不补 Teleport 遮罩，不靠硬编码层级解决叠加。
- 普通图片预览不使用 ImageViewer 全屏或窗口模式，不附加 ImageViewer 工具栏；后续确需缩放、旋转、镜像、多图切换或专门下载工具时，先明确业务要求并讨论方案，不自行恢复另一套预览外观。

## 标准接入示例

通过 `@/components/foundation` 显式导入 `AdminDialog`。以下状态与标题由页面原有预览流程提供，不能据此重写附件加载流程。

```vue
<AdminDialog
  v-model:visible="previewVisible"
  :confirmation="{ kind: 'none' }"
  confirm-function="close"
  :header="previewTitle"
  width="min(960px, 94vw)"
  mode="modal"
  show-overlay
  close-on-overlay-click
  :footer="false"
  @close="previewVisible = false"
>
  <img v-if="previewVisible" :src="previewUrl" :alt="previewAlt" style="max-width: 100%" />
</AdminDialog>
```

## 保留约定与存量边界

权限、数据范围、预览入口、附件 URL／Blob 的获取与释放、加载失败反馈和非图片文件下载继续复用原流程；不能为了统一外观改为公开地址、跳过授权请求或扩大可查看范围。关闭图片仅关闭本次预览，不关闭背景详情／编辑表单、不移除附件、不提交业务数据。

视频播放器、富文本编辑／阅读中的图片及专门看图工具不因本次普通图片预览标准自动改造。存量模块在后续对应任务中接入；如会移除已存在的业务工具或改变交互，须先取得具体授权。本轮规范登记不代表所有模块已迁移。

## 验证要求

接入时验证遮罩显示、点击外围关闭、点击图片不关闭、右上角关闭及 ESC 关闭、关闭后可重开，以及背景表单和附件状态保持。涉及私有图片时继续验证授权接口；按任务影响范围验证，不为纯规范修改启动页面或后端。

官方接口依据：[TDesign Dialog](https://tdesign.tencent.com/vue-next/components/dialog)。

## 全局遮罩约束（2026-10-19清理确认）

弹窗、抽屉及图片预览的遮罩均保留 TDesign 官方布局和视觉，不在 `src/styles` 或组件样式中覆盖 `.t-dialog__mask`、`.t-drawer__mask`、`.t-popup__overlay`、`.t-image-viewer__modal-mask`。不得通过 `!important` 强制遮罩定位、视口宽高、背景、透明度或层级；使用公开属性表达显示和关闭行为。`scripts/ui-template-policy.test.mjs` 的源码守卫检查上述内部遮罩选择器，防止重新引入覆盖。此约束不改变上传区域，上传现有内部样式依赖保留原样。
