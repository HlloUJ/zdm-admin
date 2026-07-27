# 平台 API 合约基线

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
- 请求：`{ "phone": "13800000000", "verifyCode": "888888" }`
- 响应：`token`、用户信息、角色、权限。
- 后续请求使用 `Authorization: Bearer <token>`。

## 多端 API 边界

- 管理后台：`/api/admin/**`
- C 端用户：`/api/customer/**`
- 设计师端：`/api/designer/**`
- 门店导购端：`/api/guide/**`
- 开放或公共能力：`/api/open/**` 或 `/api/common/**`

各端 Controller 只处理端侧入参、权限与展示所需 DTO，核心业务逻辑应沉到平台领域服务。

## 已落地 CRUD

- `GET /api/admin/tenants`、`POST /api/admin/tenants`、`PUT /api/admin/tenants/{id}`、`DELETE /api/admin/tenants/{id}`
- `GET /api/admin/stores`、`POST /api/admin/stores`、`PUT /api/admin/stores/{id}`、`DELETE /api/admin/stores/{id}`
- `GET /api/admin/roles`、`POST /api/admin/roles`、`PUT /api/admin/roles/{id}`、`DELETE /api/admin/roles/{id}`
- `GET /api/admin/employees`、`POST /api/admin/employees`、`PUT /api/admin/employees/{id}`、`DELETE /api/admin/employees/{id}`

## 平台身份权限基线

- `platform_clients`：端类型，目前包含 `admin`、`customer`、`designer`、`guide`。
- `accounts`：统一账号，一个手机号对应一个平台账号。
- `account_identities`：账号在不同端的身份，可绑定租户、门店或业务主体。
- `permissions`：按端区分的权限码，例如 `admin:tenant:manage`。
- `role_permissions`：角色与权限关系。
- `account_roles`：账号在某个端和数据范围内拥有的角色。

完整字段以 Swagger UI 和 Flyway 迁移文件为准。
