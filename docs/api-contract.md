# 平台 API 合约基线

本文只记录接口和数据结构事实。账号、身份、组织、角色及权限的业务语义以 Notion《统一账号与权限体系原则》为准；具体字段以 Swagger UI 和 Flyway 迁移为准。

## 通用响应

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

业务错误使用非 0 `code`，HTTP 参数错误返回 400，未登录返回 401。

## 鉴权

- 管理后台登录：`POST /api/admin/auth/login`
- 请求：`{ "phone": "15926626945", "verifyCode": "888888" }`
- 响应：`token`、用户信息、角色、权限。
- 后续请求使用 `Authorization: Bearer <token>`。

## 多端 API 边界

- 管理后台：`/api/admin/**`
- C 端用户：`/api/customer/**`
- 设计师端：`/api/designer/**`
- 门店导购端：`/api/guide/**`
- 门店端：`/api/store/**`
- 工厂端：`/api/factory/**`
- 安装端：`/api/installer/**`
- 供应商端：`/api/supplier/**`
- 开放或公共能力：`/api/open/**` 或 `/api/common/**`

各端 Controller 只处理端侧入参、权限与展示所需 DTO，核心业务逻辑应沉到平台领域服务。

## 已落地 CRUD

- `GET /api/admin/tenants`、`POST /api/admin/tenants`、`PUT /api/admin/tenants/{id}`、`DELETE /api/admin/tenants/{id}`
- `GET /api/admin/stores`、`POST /api/admin/stores`、`PUT /api/admin/stores/{id}`、`DELETE /api/admin/stores/{id}`
- `GET /api/admin/roles`、`POST /api/admin/roles`、`PUT /api/admin/roles/{id}`、`DELETE /api/admin/roles/{id}`
- `GET /api/admin/employees`、`POST /api/admin/employees`、`PUT /api/admin/employees/{id}`、`DELETE /api/admin/employees/{id}`
- 商品中心：
  - `/api/admin/product-categories`
  - `/api/admin/product-attributes`
  - `/api/admin/product-attribute-values`
  - `/api/admin/master-data`
- 库存中心：
  - `/api/admin/slab-varieties`
  - `/api/admin/slabs`
  - `/api/admin/finished-products`
- 供应商协同：`/api/admin/suppliers`
- 工艺中心：`/api/admin/crafts`
- 订单中心：`/api/admin/orders`

以上资源均支持 `GET` 列表、`POST` 新增、`PUT /{id}` 修改、`DELETE /{id}` 删除。

## 平台身份权限基线

- `platform_clients`：端类型，目前包含 `admin`、`customer`、`designer`、`guide`、`store`、`factory`、`installer`、`supplier`。
- `accounts`：统一账号，一个手机号对应一个平台账号。
- `account_identities`：账号在不同端的身份，可绑定租户、门店或业务主体。
- `permissions`：按端区分的权限码，例如 `admin:tenant:manage`。
- `role_permissions`：角色与权限关系。
- `account_roles`：账号在某个端和数据范围内拥有的角色。

完整字段以 Swagger UI 和 Flyway 迁移文件为准。

## 后续接口演进

- 商品中心下一步补类目属性模板、价格体系、上下架、图片/视频素材。
- 库存中心下一步补锁库、预留、释放、调拨、盘点和批次追溯接口。
- 订单中心下一步补状态机、订单明细、费用明细、履约节点和结算触发事件。
- 多端接口上线时，只新增端侧 Controller，不复制核心业务逻辑。
