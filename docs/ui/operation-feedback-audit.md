# 操作校验与反馈迁移台账

范围：当前仓库 src 下所有页面、独立模块及共享业务组件；foundation 作为公共展示基座由原有反馈守卫独立约束。源码 AST 登记 49 个文件、533 个操作／表单／查看／查询绑定；每项绑定、类型、混合分支和脚本指纹见 [机器台账](operation-feedback-registry.json)。无操作入口的静态页面不适用。

配件三端通过 src/modules/accessory/routes.ts 复用成品现货三端页面；门店编辑路由也复用列表页面。混合分支按实际请求策略登记，不能以界面上的“批量”推断原子性。

| 对象                               | 实现依据／处理                                                     | 验证状态     |
| ---------------------------------- | ------------------------------------------------------------------ | ------------ |
| 门店成品现货／配件上架             | 共享执行状态和分类／售价校验；原作用域和锁顺序保留                 | 本地门禁通过 |
| 供应链成品现货／配件上架           | 复用 lifecycle.checkSourceTransition；原操作权限保留               | 本地门禁通过 |
| 商品分类删除                       | 复用执行检查，覆盖商品、子分类、模板版本；阻断 Toast               | 本地门禁通过 |
| 门店分类删除                       | 已有商品／子分类条件前移为 Toast；执行仍复核                       | 本地门禁通过 |
| 成品／配件价格配置删除             | checkDelete 同时用于预检和执行；数据权限保留                       | 本地门禁通过 |
| 供应商、供货类型删除               | 共用原引用检查，类型兼顾列表引用信息和服务端复核                   | 本地门禁通过 |
| 大板品种、产地、色系分类删除       | 共用原引用检查，保留末次执行拒绝                                   | 本地门禁通过 |
| 门店恢复／删除                     | 共用原租户状态及供应商引用限制                                     | 本地门禁通过 |
| 租户彻底删除                       | 已有预检不合格 Toast；合格仍保留名称确认                           | 本地门禁通过 |
| 订单确认（模拟原型）               | 从实际确认方法抽取无副作用检查，并在两处复用                       | 本地门禁通过 |
| 属性、门店级别、门店来源、租户预检 | 串行检查及销毁／身份路径变化的响应保护                             | 本地门禁通过 |
| 批量上架／删除                     | 原端点、部分成功策略与最终弹框保留；不加逐项预检                   | 本地门禁通过 |
| 成品／配件其他独立批量请求         | 撤回额外结果汇总扩展，原样保留串行／并发、遇错停止、选择保留及反馈 | 本地门禁通过 |
| 大板及客户整体批量                 | 保留原服务端批量事务与整体校验                                     | 本地门禁通过 |
| 其他登记操作                       | 按实际处理器保留查看、表单、查询和无额外限制的确认；无新业务限制   | 本地门禁通过 |

## 自查及证据

后端定向验证曾因新增夹具缺少指导价、MyBatis 读取缓存未清理及接口夹具缺少动作权限而失败；均修正夹具，保留原断言及失败记录。最终定向 54 项通过（零跳过），覆盖成品／配件预检接口权限、门店隔离、无状态／日志写入以及最终提交再次拒绝。公共预检、批量结果及订单模型定向 38 项通过；原始上架和删除阻断交互用例通过。最终结果以 .task-verification 和后端 surefire 原始报告为准，未通过项不得标为已完成。

守卫反例覆盖漏登记、脚本漂移、阻断弹框、混合分支漏类型、部分成功批量误加逐项预检。结构守卫不能代替业务语义/API验证，也不构成独立不可绕过的权限隔离。

无批准例外。生产发布、持久数据清理、源码推送合并均不属于本次执行口令。

自查补修：已将旧确认入口接入同一实例的 execute 串行保护及原生 loading，避免确认按钮连续触发重复写入；新增自动化实证一次执行请求。新增 E2E 文件已登记原两分片清单，旧分片分配未变。首次完整执行在前置诊断因漏登记该文件而被阻断，未启动其后全量业务门禁；补登记后按新候选重验，原失败日志保留。

全量回归纠偏：首轮 878 项浏览器回归中 20 项失败，暴露额外批量汇总改变了既有串行／选择／弹框行为，以及单条上架未刷新来源失效覆盖层。恢复原批量处理器和结果组件，不修改原业务断言；单条补齐来源刷新再预检。工程测试另有 1 项因两个新增／修改的读取者未登记而保守升级，精确补登记，允许缩小范围的工具清单不扩张。失败报告保留，不重新解释为通过。

## 最终本地验证回执

准确源码候选的完整门禁 `verify:local` 已通过：438 项前端单测、82 项源码守卫、878 项自动化浏览器回归、726 项后端测试、740 项工程测试；构建、格式、lint、类型、样式、后端静态质量及 CI 复用前置诊断通过。适用测试零跳过、零重试，原始失败未删除。此前 56 项纠偏交互与 26 项工程范围定向检查通过，不能代替本次完整门禁。

回执：`.task-verification/runs/764041a6-0f40-4333-80ec-f19f0777e891/performance.json`。此后仅回填本 Markdown 台账及规范交叉引用，非 Markdown 源码摘要保持不变，并单独验证格式及源码守卫；不为状态回填重新运行全量业务门禁。正式远端 CI、合并及主线运行交接尚未执行。

原批量处理器审查：成品现货三端共 6 个执行处理器与任务开始时源码逐字一致（仅下架提交入口新增防重复保护）；未保留额外汇总组件或改变串行／并发、遇错停止、失败选择及原反馈。

## 逐文件覆盖索引

每个绑定的具体处理器、混合分支和脚本指纹在机器台账登记；现有条件以所链接原实现及其原 API 校验为依据，不从操作文案推断。下表记录源码复核与适用门禁结论。

| 操作入口源码／条件定位                                                                                                                                           | 绑定数 | 显式类型                            | 处理结论             | 验证依据                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------- | -------------------- | -------------------------- |
| [src/components/AdminSideMenu.vue](../../src/components/AdminSideMenu.vue)                                                                                       | 2      | form、view                          | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/components/AdminTopNav.vue](../../src/components/AdminTopNav.vue)                                                                                           | 2      | form、view                          | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/components/DecimalInput.vue](../../src/components/DecimalInput.vue)                                                                                         | 1      | form                                | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/components/OperationsBatchShelfResult.vue](../../src/components/OperationsBatchShelfResult.vue)                                                             | 1      | view                                | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/components/customer/CustomerFollowupAttachments.vue](../../src/components/customer/CustomerFollowupAttachments.vue)                                         | 4      | form、view                          | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/components/permission/PermissionAssignmentMatrix.vue](../../src/components/permission/PermissionAssignmentMatrix.vue)                                       | 6      | form、view                          | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/components/product-logs/ProductLogFieldValue.vue](../../src/components/product-logs/ProductLogFieldValue.vue)                                               | 1      | view                                | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/components/product-logs/ProductOperationLogTemplate.vue](../../src/components/product-logs/ProductOperationLogTemplate.vue)                                 | 9      | form、query、view                   | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/craft/finished-stock/index.vue](../../src/pages/craft/finished-stock/index.vue)                                                                       | 9      | dispatch、form、query、single、view | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/customer/index.vue](../../src/pages/customer/index.vue)                                                                                               | 14     | dispatch、form、single、view        | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/employee-invite/index.vue](../../src/pages/employee-invite/index.vue)                                                                                 | 4      | form、view                          | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/finished-stock/management/components/FinishedCreationSnapshot.vue](../../src/pages/finished-stock/management/components/FinishedCreationSnapshot.vue) | 1      | view                                | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/finished-stock/management/components/HistoricalRichText.vue](../../src/pages/finished-stock/management/components/HistoricalRichText.vue)             | 1      | view                                | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/finished-stock/management/components/PriceSourceToggle.vue](../../src/pages/finished-stock/management/components/PriceSourceToggle.vue)               | 2      | form                                | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/finished-stock/management/components/ProductDetail.vue](../../src/pages/finished-stock/management/components/ProductDetail.vue)                       | 2      | view                                | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/finished-stock/management/components/SalesLogFullscreen.vue](../../src/pages/finished-stock/management/components/SalesLogFullscreen.vue)             | 1      | view                                | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/finished-stock/management/components/SpecPriceInput.vue](../../src/pages/finished-stock/management/components/SpecPriceInput.vue)                     | 1      | form                                | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/finished-stock/management/index.vue](../../src/pages/finished-stock/management/index.vue)                                                             | 40     | dispatch、form、query、view         | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/finished-stock/store/StoreFinishedEditor.vue](../../src/pages/finished-stock/store/StoreFinishedEditor.vue)                                           | 12     | form、view                          | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/finished-stock/store/index.vue](../../src/pages/finished-stock/store/index.vue)                                                                       | 24     | dispatch、form、query、single、view | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/finished-stock/store/price-configuration.vue](../../src/pages/finished-stock/store/price-configuration.vue)                                           | 18     | dispatch、form、query、view         | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/finished-stock/supply-chain/index.vue](../../src/pages/finished-stock/supply-chain/index.vue)                                                         | 54     | dispatch、form、query、view         | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/login/index.vue](../../src/pages/login/index.vue)                                                                                                     | 2      | form、view                          | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/order/prototype/OrderActionDialog.vue](../../src/pages/order/prototype/OrderActionDialog.vue)                                                         | 1      | form                                | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/order/prototype/OrderEditor.vue](../../src/pages/order/prototype/OrderEditor.vue)                                                                     | 9      | form、query                         | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/order/prototype/SalesOrderList.vue](../../src/pages/order/prototype/SalesOrderList.vue)                                                               | 10     | dispatch、form、view                | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/order/prototype/index.vue](../../src/pages/order/prototype/index.vue)                                                                                 | 19     | dispatch、form、single、view        | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/permission/employee/index.vue](../../src/pages/permission/employee/index.vue)                                                                         | 13     | dispatch、form、query、single、view | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/permission/terminal-function/index.vue](../../src/pages/permission/terminal-function/index.vue)                                                       | 3      | form、view                          | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/product/attribute-value/index.vue](../../src/pages/product/attribute-value/index.vue)                                                                 | 8      | dispatch、form、query、single、view | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/product/attribute/index.vue](../../src/pages/product/attribute/index.vue)                                                                             | 8      | dispatch、form、query、single、view | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/product/category-attribute-template/index.vue](../../src/pages/product/category-attribute-template/index.vue)                                         | 25     | form、single、view                  | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/product/category/index.vue](../../src/pages/product/category/index.vue)                                                                               | 11     | form、query、single、view           | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/product/markup-configuration/index.vue](../../src/pages/product/markup-configuration/index.vue)                                                       | 12     | form、query、single                 | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/role/management/index.vue](../../src/pages/role/management/index.vue)                                                                                 | 7      | form、single                        | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/slab/color/index.vue](../../src/pages/slab/color/index.vue)                                                                                           | 15     | form、query、single、view           | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/slab/grade/index.vue](../../src/pages/slab/grade/index.vue)                                                                                           | 8      | form、query、single                 | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/slab/management/components/SlabProductFormLayout.vue](../../src/pages/slab/management/components/SlabProductFormLayout.vue)                           | 6      | form、view                          | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/slab/management/index.vue](../../src/pages/slab/management/index.vue)                                                                                 | 40     | dispatch、form、query、view         | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/slab/origin/index.vue](../../src/pages/slab/origin/index.vue)                                                                                         | 8      | dispatch、form、query、single       | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/slab/supply-chain/index.vue](../../src/pages/slab/supply-chain/index.vue)                                                                             | 34     | dispatch、form、query、view         | 保留，源码已复核     | 本次源码守卫及完整适用门禁 |
| [src/pages/slab/texture/index.vue](../../src/pages/slab/texture/index.vue)                                                                                       | 14     | form、query、single、view           | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/slab/variety/index.vue](../../src/pages/slab/variety/index.vue)                                                                                       | 9      | dispatch、form、query、single       | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/store-category/management/index.vue](../../src/pages/store-category/management/index.vue)                                                             | 12     | form、query、single、view           | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/store-level/management/index.vue](../../src/pages/store-level/management/index.vue)                                                                   | 8      | form、query、single                 | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/supplier/management/index.vue](../../src/pages/supplier/management/index.vue)                                                                         | 8      | dispatch、form、query、single       | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/supplier/supply-type/index.vue](../../src/pages/supplier/supply-type/index.vue)                                                                       | 9      | form、query、single                 | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/tenant/management/index.vue](../../src/pages/tenant/management/index.vue)                                                                             | 13     | dispatch、form、query、single       | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
| [src/pages/tenant/store/index.vue](../../src/pages/tenant/store/index.vue)                                                                                       | 12     | dispatch、form、query、single       | 已调整，其余约定保留 | 本次源码守卫及完整适用门禁 |
