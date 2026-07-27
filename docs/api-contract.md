# API 合约基线

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

- `POST /api/auth/login`
- 请求：`{ "phone": "13800000000", "verifyCode": "888888" }`
- 响应：`token`、用户信息、角色、权限。
- 后续请求使用 `Authorization: Bearer <token>`。

## 已落地 CRUD

- `GET /api/tenants`、`POST /api/tenants`、`PUT /api/tenants/{id}`、`DELETE /api/tenants/{id}`
- `GET /api/stores`、`POST /api/stores`、`PUT /api/stores/{id}`、`DELETE /api/stores/{id}`
- `GET /api/roles`、`POST /api/roles`、`PUT /api/roles/{id}`、`DELETE /api/roles/{id}`
- `GET /api/employees`、`POST /api/employees`、`PUT /api/employees/{id}`、`DELETE /api/employees/{id}`

完整字段以 Swagger UI 和 Flyway 迁移文件为准。
