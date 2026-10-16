# 全局查询区迁移清单

2026-10-15：按用户确认的查询标准统一接入公共样式。仅迁移布局，不改变字段、权限、模型、事件和请求。

所有区域引用 `src/components/foundation/official/query-layout.css`；应用入口导入一次，公共列表独立示例复用同一文件。旧页面只增加标准标记或必要容器，不复制 CSS。

| 页面或共用入口                                                | 查询区域数 |
| ------------------------------------------------------------- | ---------- |
| `src/pages/accessory/attribute/index.vue`                     | 1          |
| `src/pages/craft/finished-stock/index.vue`                    | 1          |
| `src/pages/finished-stock/attribute/index.vue`                | 1          |
| `src/pages/finished-stock/management/index.vue`               | 1          |
| `src/pages/finished-stock/store/index.vue`                    | 2          |
| `src/pages/finished-stock/store/price-configuration.vue`      | 1          |
| `src/pages/finished-stock/supply-chain/index.vue`             | 1          |
| `src/pages/permission/employee/index.vue`                     | 1          |
| `src/pages/product/attribute/index.vue`                       | 1          |
| `src/pages/product/attribute-value/index.vue`                 | 1          |
| `src/pages/product/category/index.vue`                        | 1          |
| `src/pages/product/markup-configuration/index.vue`            | 1          |
| `src/pages/slab/color/index.vue`                              | 1          |
| `src/pages/slab/grade/index.vue`                              | 1          |
| `src/pages/slab/management/index.vue`                         | 1          |
| `src/pages/slab/origin/index.vue`                             | 1          |
| `src/pages/slab/supply-chain/index.vue`                       | 1          |
| `src/pages/slab/texture/index.vue`                            | 1          |
| `src/pages/slab/variety/index.vue`                            | 1          |
| `src/pages/store-category/management/index.vue`               | 1          |
| `src/pages/store-level/management/index.vue`                  | 1          |
| `src/pages/supplier/management/index.vue`                     | 1          |
| `src/pages/supplier/supply-type/index.vue`                    | 1          |
| `src/pages/tenant/management/index.vue`                       | 1          |
| `src/pages/tenant/store/index.vue`                            | 1          |
| `src/pages/customer/index.vue`                                | 1          |
| `src/components/product-logs/ProductOperationLogTemplate.vue` | 1          |

合计 28 个页面或共用入口、29 个查询区域；同一页面可由多个业务端或路由复用，共用日志入口覆盖成品现货和大板各端。

未套用查询栅格：编辑／发布表单、价格和SKU矩阵、分类属性模板“添加属性”弹窗的即时搜索、下拉组件自身搜索。它们保持原有交互，不新增查询／重置按钮。

验收：每个列表路由在多种视口下校验列数、10:2及不溢出；公共入口覆盖1/2/3/4/7个字段；业务回归覆盖查询、重置、日志日期输入和编辑提交。
