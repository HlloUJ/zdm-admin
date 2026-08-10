# 管理后台反馈提示规范

所有业务模块必须通过 `@/components/foundation` 提供的反馈基座展示全局提示，不得直接调用 TDesign 的 `MessagePlugin`、`NotifyPlugin` 或 `DialogPlugin`。

## 提示类型

| 场景         | 组件/API                               | 文案原则                                                |
| ------------ | -------------------------------------- | ------------------------------------------------------- |
| 操作成功     | `adminFeedback.actionSuccess`          | 使用 `已 + 动作 + “对象名称”`，例如 `已停用“一级分类3”` |
| 操作失败     | `adminFeedback.error` / `actionError`  | 使用“动作失败：原因”，不展示 SQL、异常栈等内部细节      |
| 风险提醒     | `adminFeedback.warning`                | 说明风险和下一步，不用成功色表达警告                    |
| 普通信息     | `adminFeedback.info`                   | 仅用于无成功、失败或风险语义的信息                      |
| 执行前确认   | `AdminConfirmDialog`，`mode="confirm"` | 标题和按钮写明动作，例如“确认删除”                      |
| 业务规则阻断 | `AdminConfirmDialog`，`mode="blocked"` | 标题使用“无法 + 动作”，按钮统一为“我知道了”             |
| 页面持续状态 | `t-alert` 或表单校验                   | 不使用会自动消失的全局消息                              |

## 视觉和行为

- 全局消息使用 TDesign 官方 Message 视觉样式，不覆盖其宽度、内边距、圆角、阴影或换行规则。
- 未经用户明确要求，不得为 TDesign Message 新增任何自定义视觉 CSS；统一反馈基座只负责文案和行为。
- 成功、普通信息展示 2.5 秒；警告、失败展示 4 秒。
- 同一提示 800ms 内只展示一次，页面同时最多展示 3 条。
- 文案过长时换行，不撑出视口。

## 使用示例

存在明确操作对象时必须使用 `actionSuccess` 并传入对象名称；只有发送验证码、刷新列表等不存在单一对象的成功反馈，才使用 `adminFeedback.success`。

```ts
import { adminFeedback } from '@/components/foundation';

adminFeedback.actionSuccess({ action: '停用', target: category.name });
adminFeedback.actionError({ action: '保存', error, fallback: '请检查填写内容后重试' });
```

```vue
<AdminConfirmDialog
  v-model:visible="deleteVisible"
  action="删除"
  object-type="分类"
  :object-name="deleteTarget?.name"
  @confirm="handleDelete"
/>
```

ESLint 和 `scripts/feedback-foundation.test.mjs` 会阻止业务模块重新直接引入第三方全局提示插件。
