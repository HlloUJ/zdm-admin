# 全平台多行文本错误展示核对（2026-10-19）

状态：本轮已统一24处可编辑多行文本框的100字符默认上限与框内右下角原生统计；只读邀请链接保持。错误继续使用既有官方展示链路，未重接校验。

核对 `src` 全部 Vue 模板，共25处 Textarea：19处既有100字符上限、1处既有500字符上限、4处可编辑无明确上限、1处只读邀请链接。这是调整前的上限清单；本轮将4处无上限及1处500上限统一为100，保留只读行为和历史值，不自动截断。

| 文件／字段                                                             | 原上限     | 原错误来源                       | 本轮处理                                      |
| ---------------------------------------------------------------------- | ---------- | -------------------------------- | --------------------------------------------- |
| `src/pages/accessory/attribute/index.vue`／`formData.remark`           | 100        | Form原生rules                    | 100字符／框内统计；原规则与错误展示保持       |
| `src/pages/craft/finished-stock/index.vue`／`formData.remark`          | 100        | 无独立字段错误文案链路（可编辑） | 100字符／框内统计；不新增独立错误校验         |
| `src/pages/customer/index.vue`／`profile.requirement`                  | 100        | 无独立字段错误文案链路（可编辑） | 100字符／框内统计；不新增独立错误校验         |
| `src/pages/customer/index.vue`／`profile.remark`                       | 100        | 无独立字段错误文案链路（可编辑） | 100字符／框内统计；不新增独立错误校验         |
| `src/pages/customer/index.vue`／`followForm.content`                   | 100        | 既有手工反馈                     | 100字符／框内统计；保留status／tips及空白占位 |
| `src/pages/customer/index.vue`／`followForm.nextFollowTask`            | 100        | 无独立字段错误文案链路（可编辑） | 100字符／框内统计；不新增独立错误校验         |
| `src/pages/finished-stock/attribute/index.vue`／`formData.remark`      | 100        | Form原生rules                    | 100字符／框内统计；原规则与错误展示保持       |
| `src/pages/finished-stock/management/index.vue`／`reasonForm.detail`   | 无明确上限 | 无独立字段错误文案链路（可编辑） | 100字符／框内统计；不新增独立错误校验         |
| `src/pages/finished-stock/store/index.vue`／`offShelf.detail`          | 500        | 无独立字段错误文案链路（可编辑） | 100字符／框内统计；不新增独立错误校验         |
| `src/pages/finished-stock/supply-chain/index.vue`／`reasonForm.detail` | 无明确上限 | 无独立字段错误文案链路（可编辑） | 100字符／框内统计；不新增独立错误校验         |
| `src/pages/permission/employee/index.vue`／`inviteLink`                | 无明确上限 | 只读展示                         | 保留，不新增校验或字数限制                    |
| `src/pages/permission/employee/index.vue`／`profileFormData.remark`    | 100        | Form原生rules                    | 100字符／框内统计；原规则与错误展示保持       |
| `src/pages/role/management/index.vue`／`formData.remark`               | 100        | 无独立字段错误文案链路（可编辑） | 100字符／框内统计；不新增独立错误校验         |
| `src/pages/slab/color/index.vue`／`formData.remark`                    | 100        | Form原生rules                    | 100字符／框内统计；原规则与错误展示保持       |
| `src/pages/slab/color/index.vue`／`categoryForm.remark`                | 100        | Form原生rules                    | 100字符／框内统计；原规则与错误展示保持       |
| `src/pages/slab/grade/index.vue`／`formData.remark`                    | 100        | Form原生rules                    | 100字符／框内统计；原规则与错误展示保持       |
| `src/pages/slab/management/index.vue`／`reasonForm.detail`             | 无明确上限 | 无独立字段错误文案链路（可编辑） | 100字符／框内统计；不新增独立错误校验         |
| `src/pages/slab/origin/index.vue`／`formData.remark`                   | 100        | Form原生rules                    | 100字符／框内统计；原规则与错误展示保持       |
| `src/pages/slab/supply-chain/index.vue`／`reasonForm.detail`           | 无明确上限 | 无独立字段错误文案链路（可编辑） | 100字符／框内统计；不新增独立错误校验         |
| `src/pages/slab/texture/index.vue`／`formData.remark`                  | 100        | Form原生rules                    | 100字符／框内统计；原规则与错误展示保持       |
| `src/pages/slab/variety/index.vue`／`formData.remark`                  | 100        | Form原生rules                    | 100字符／框内统计；原规则与错误展示保持       |
| `src/pages/store-level/management/index.vue`／`formData.remark`        | 100        | Form原生rules                    | 100字符／框内统计；原规则与错误展示保持       |
| `src/pages/supplier/management/index.vue`／`formData.remark`           | 100        | Form原生rules                    | 100字符／框内统计；原规则与错误展示保持       |
| `src/pages/tenant/management/index.vue`／`formData.remark`             | 100        | Form原生rules                    | 100字符／框内统计；原规则与错误展示保持       |
| `src/pages/tenant/store/index.vue`／`formData.remark`                  | 100        | Form原生rules                    | 100字符／框内统计；原规则与错误展示保持       |

## 原生Form字段的公开接口边界

当前安装的TDesign FormItem自行维护输入变化、失焦及提交时的校验结果，公开属性没有把单字段当前错误传给子Textarea的接口；默认插槽也未提供错误上下文。Form的onValidate可以接收整表校验结果，不能直接代替每次输入／失焦字段反馈。

不通过关闭Form校验、只保留提交校验、重复运行规则、DOM读取、内部注入或自定义CSS掩盖此差异。若需要公共适配，先明确方案，保留原验收条件、上限、校验时机、错误清除及保存拒绝行为，再按用户确认实施。

现有13处原生规则字段均为备注长度校验，其中员工备注使用既有自定义长度校验器；其余规则不变。另10处可编辑字段没有现有独立字段错误文案链路，继续保留Textarea自身的长度约束、统计和超限状态，不能为凑齐status／tips而编造新校验。客户跟进内容已经符合原生同行提示和行高稳定要求。

本轮只调整5处模板的maxlength及公共统计布局，未修改校验器、触发事件、权限、保存流程或后端；原生统计使用公共CSS网格放入输入框右下角，底部预留统计空间，错误仍在框外下方。这是用户明确授权的必要位置CSS例外，其他官方视觉保持。

## 垂直间距复核（2026-10-19）

按当前源码逐项复核24处可编辑多行文本框及1处只读邀请链接，并检查src内全部Vue／CSS中涉及Textarea、FormItem及控件容器的间距声明。

- 客户跟进内容：上一轮已移除Textarea空白tips行，复用官方FormItem帮助占位与现有公共提示布局，输入框至下一字段为24px；原校验、纠正后清除提示和保存逻辑不变，报错前后位置稳定。
- 门店成品现货下架详细说明：单条操作保留既有“选填”帮助文字，批量操作不显示该帮助；没有Textarea空白tips叠加，不删除业务说明。
- 其余22处可编辑字段：未配置额外空白tips行或独立字段间距皮肤，保留官方FormItem间距；原生统计已移到框内，不再占框外统计行。末项原生错误提示预留与弹窗内容间距不作为重复字段占位删除。
- 只读邀请链接：属于邀请说明区域，未参与可输入字段间距调整。

本轮未发现新的同类问题，未修改页面、公共CSS、校验器、上限、权限或业务交互，仅记录复核结果。客户局部间距修复后的59项相关自动化回归已经通过；本轮源码未变，不重复运行应用测试。

## 官方自动增高实施（2026-10-19）

- 20个页面共24处可编辑Textarea全部使用 `:autosize="{}"`，不指定minRows／maxRows，由官方组件计算高度并关闭手动拖动。移除此前4～6行、未配置或按单条／批量切换的差异。
- 24处均保留 `:maxlength="100"`、官方原生统计及既有框内右下角公共布局；本轮未修改CSS。员工邀请链接的只读展示及原高度配置不变。
- 精确核对全部20个页面的script字节不变；校验、权限、接口、保存及其他业务事件未修改。模板差异已按批准内容登记，不重置业务基线。
- 专项自动化62项通过，覆盖桌面／窄屏增高、删除后收缩、无手动拖动、超过6行仍完整显示、统计防遮挡、历史长值、错误稳定及客户保存。
- 完整前端E2E共470项通过，零跳过、零重试；变更源码守卫、类型、ESLint、Stylelint及相关单元测试全部通过。
- 未涉及后端或运行配置，本轮未执行后端测试；预览未重启或切换。
