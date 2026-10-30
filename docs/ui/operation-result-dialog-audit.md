# 操作结果提示弹框全系统扫描清单

日期：2026-10-30。依据：[操作结果提示弹框全局标准](operation-result-dialog-standard.md)。源码快照：`9c4500c4c9f008f8f3934723e273e7f4a5ac29c7`，分支 `codex/product-off-shelf-to-warehouse`。

本轮只修改规范与本清单，不修改任何页面、公共组件、业务逻辑或测试，不迁移存量弹框。

## 扫描范围与方法

扫描 `src` 全部80个 Vue 文件及其路由、公共封装、配件模块适配和反馈服务。Vue模板AST共提取113个弹框定义／封装调用节点，分布于40个文件；这个数量包含公共封装底层节点和操作前确认，不等于113种结果弹框，也不等于113个独立页面。

同时检索程序式弹框入口（DialogPlugin、MessageBox、Modal、window.alert/confirm等）及原生dialog入口，未发现额外实现。检查反馈公共服务后，Toast不纳入本次弹框清单。订单原型现有Vue页面也纳入扫描。

对候选逐一核对展示内容、打开时机、确认处理及共享使用方；不是仅按弹框宽度、标题或关闭按钮分类。结论属于源码静态审计；没有将“源码未建立保障”表述为已经实测发生溢出。

## 确定不符合：批量上架结果（1套共用实现）

实现：[OperationsBatchShelfResult.vue](../../src/components/OperationsBatchShelfResult.vue)，模板第2行；通用宽度来源：[AdminDialog.vue](../../src/components/foundation/AdminDialog.vue)第39行。

| 检查项         | 当前实现                                | 与新规范差异                                                        |
| -------------- | --------------------------------------- | ------------------------------------------------------------------- |
| 弹框宽度       | 未传width，继承固定480px                | 未按结果内容自适应                                                  |
| 最大宽度       | 结果组件未声明视口宽度上限              | 未建立 `min(960px, 90vw)` 的专项约束                                |
| 表格分配       | 第15行固定表格布局，两列无宽度配置      | 未按正文需求分配宽度，未实现表头最小宽度及短列让宽                  |
| 连续字符串     | 未建立结果展示专用换行规则              | 迁移时须验证长ID、英文、URL不会撑宽或被裁切；此项不是已实测溢出结论 |
| 超长结果高度   | 未建立结果展示专用视口高度约束          | 迁移时须验证仅正文纵向滚动、标题和确认操作可用                      |
| 内部外观与确认 | 使用原生Typography、Table及既有关闭确认 | 未发现需要重绘字体、边距或改变确认业务的依据                        |

该实现无失败明细时展示纯文字摘要，有失败明细时展示摘要和表格，两种情况都属于同一结果弹框。

### 实际使用清单

| 用户端   | 模块／路由                                         | 使用本结果弹框的Tab |
| -------- | -------------------------------------------------- | ------------------- |
| 运营端   | 成品现货 `/finished-stock-management`              | 全部、仓库中        |
| 运营端   | 配件 `/accessory-management`                       | 全部、仓库中        |
| 运营端   | 大板 `/slab-management`                            | 全部、仓库中        |
| 供应链端 | 成品现货 `/supply-chain/finished-stock-management` | 全部                |
| 供应链端 | 配件 `/supply-chain/accessory-management`          | 全部                |
| 供应链端 | 大板 `/supply-chain/slab-management`               | 全部                |
| 门店端   | 成品现货 `/store/finished-stock-management`        | 全部                |
| 门店端   | 配件 `/store/accessory-management`                 | 全部                |

合计：8个模块视图、11个Tab操作入口，共用1套结果弹框。配件入口通过 `src/modules/accessory/routes.ts` 复用相应端成品现货页面；没有门店大板对应入口，不新增此项。

调用位置：运营成品1162行、运营大板1137行、供应链成品1102行、供应链大板936行、门店成品480行；均指对应 `src/pages/finished-stock/{management,supply-chain,store}/index.vue` 或 `src/pages/slab/{management,supply-chain}/index.vue`。供应链及门店的原仓库中处理不使用这一结果组件，不把它们计入11个入口。

## 需单独确认归类：邀请员工生成结果（1套实现）

位置：[员工管理](../../src/pages/permission/employee/index.vue)第153行，路由 `/employee-management`。

`openInviteDialog`（第614行）先调用 `createEmployeeInvite` 生成邀请，再填入链接并打开弹框；弹框不是新增／编辑表单，包含只读链接、复制链接和关闭操作。因此它具备操作后结果展示特征，应列出，不能因有textarea便漏掉。

当前宽度固定560px，链接文本框固定3行，不按内容自适应宽度，也没有结果专项最大宽度约束。链接正文是否需要全部展开、是否保留只读文本框等，属于这一业务产物展示界面的具体处理，不能仅依照普通提示弹框推断后自行修改。

本清单将其作为边界候选，未将其冒充已批准迁移对象。后续确认纳入时，应保留复制、链接有效期、多次使用规则及原关闭行为。该页面按登录身份与既有权限处理员工管理范围，不新建或推断新的端级路由。

## 已检查但不属于本规范的弹框

| 类型／对象                             | 代表位置                                                                                            | 排除依据                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 新增／编辑、权限配置、价格和批量填写   | 各表单及员工、角色、价格配置页                                                                      | 弹框中仍需填写或执行业务，属于操作界面                               |
| 删除、上下架、停启用、发布新版本等确认 | 各AdminConfirmDialog及对应确认弹框                                                                  | 确认后才执行操作，是操作前确认                                       |
| 商品分类无法删除、门店分类无法删除     | `product/category/index.vue:167`、`store-category/management/index.vue:178`                         | 打开前根据已有商品／下级分类判断阻断；未执行删除，不是操作后返回结果 |
| 彻底删除租户预检                       | `tenant/management/index.vue:192`                                                                   | 先取得预检数据，仍需输入名称并确认才执行真正删除；不是删除结果       |
| 商品日志操作详情、订单操作前后数据     | `components/product-logs/ProductOperationLogTemplate.vue:99`、`pages/order/prototype/index.vue:316` | 用户主动查看历史记录                                                 |
| 大板历史下架原因                       | `pages/slab/management/index.vue:1112`、`pages/slab/supply-chain/index.vue:911`                     | 历史查看，不是本次操作完成结果                                       |
| 色系分类、纹理别名管理                 | `pages/slab/color/index.vue:121`、`pages/slab/texture/index.vue:105`                                | 弹框内继续管理、增删改，不是结果确认                                 |
| 图片、视频、历史媒体、工艺预览、凭证   | 对应预览组件及页面                                                                                  | 使用原有预览规范                                                     |
| 商品中心、规格创建、分类选择、模式切换 | 成品／配件对应页面                                                                                  | 选择或执行业务的工作界面                                             |
| Toast、行内警告与字段错误              | `components/foundation/feedback/adminFeedback.ts`及页面                                             | 非结果确认弹框，不转换展示形式                                       |

仅从当前源码确认到上述1套明确不符合实现及1套需要归类确认的候选；未发现其他独立的操作后结果确认弹框。此结论不评价被排除弹框是否符合其他规范。

## 扫描覆盖文件索引

下表为AST提取到弹框节点的全部40个文件；无弹框节点的其他Vue文件也参加了全量检索。数量是该文件的定义／调用节点数，公共封装及其使用方可能同时计数。配件共享调用和路由另外核查。

| 文件                                                                       | 节点数 |
| -------------------------------------------------------------------------- | ------ |
| `src/components/OperationsBatchShelfResult.vue`                            | 1      |
| `src/components/foundation/AdminConfirmDialog.vue`                         | 1      |
| `src/components/foundation/AdminDialog.vue`                                | 1      |
| `src/components/foundation/official/AdminFormDialog.vue`                   | 1      |
| `src/components/product-logs/ProductOperationLogTemplate.vue`              | 1      |
| `src/pages/craft/finished-stock/index.vue`                                 | 3      |
| `src/pages/customer/index.vue`                                             | 5      |
| `src/pages/finished-stock/management/components/FinishedOperationLogs.vue` | 1      |
| `src/pages/finished-stock/management/components/PriceSourceToggle.vue`     | 1      |
| `src/pages/finished-stock/management/index.vue`                            | 7      |
| `src/pages/finished-stock/shared/StoreFinishedStockDetailAdapter.vue`      | 1      |
| `src/pages/finished-stock/shared/StoreFinishedStockPoolDetailAdapter.vue`  | 1      |
| `src/pages/finished-stock/store/index.vue`                                 | 5      |
| `src/pages/finished-stock/store/price-configuration.vue`                   | 3      |
| `src/pages/finished-stock/supply-chain/index.vue`                          | 7      |
| `src/pages/order/prototype/OrderActionDialog.vue`                          | 1      |
| `src/pages/order/prototype/OrderEditor.vue`                                | 1      |
| `src/pages/order/prototype/SalesOrderList.vue`                             | 1      |
| `src/pages/order/prototype/index.vue`                                      | 6      |
| `src/pages/permission/employee/index.vue`                                  | 4      |
| `src/pages/product/attribute/index.vue`                                    | 2      |
| `src/pages/product/attribute-value/index.vue`                              | 2      |
| `src/pages/product/category/index.vue`                                     | 3      |
| `src/pages/product/category-attribute-template/index.vue`                  | 6      |
| `src/pages/product/markup-configuration/index.vue`                         | 3      |
| `src/pages/role/management/index.vue`                                      | 3      |
| `src/pages/slab/color/index.vue`                                           | 5      |
| `src/pages/slab/grade/index.vue`                                           | 2      |
| `src/pages/slab/management/components/SlabProductFormLayout.vue`           | 1      |
| `src/pages/slab/management/index.vue`                                      | 4      |
| `src/pages/slab/origin/index.vue`                                          | 2      |
| `src/pages/slab/supply-chain/index.vue`                                    | 4      |
| `src/pages/slab/texture/index.vue`                                         | 4      |
| `src/pages/slab/variety/index.vue`                                         | 2      |
| `src/pages/store-category/management/index.vue`                            | 4      |
| `src/pages/store-level/management/index.vue`                               | 2      |
| `src/pages/supplier/management/index.vue`                                  | 2      |
| `src/pages/supplier/supply-type/index.vue`                                 | 3      |
| `src/pages/tenant/management/index.vue`                                    | 4      |
| `src/pages/tenant/store/index.vue`                                         | 3      |

## 本轮成果与后续边界

本轮只建立规范、登记源码审计结果。未创建公共结果弹框能力，未调整默认宽度，未修改上述页面或复制交互，未修改任何业务和数据。清单中的迁移需要用户另行确认；不得借全局规范调整新增／编辑弹框。

文档验证仅检查格式、链接与差异范围；没有运行页面、后端或完整工程测试，因为本轮没有相应代码变更。
