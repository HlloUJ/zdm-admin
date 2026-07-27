INSERT INTO roles (name, code, category, client_code, data_scope, status, remark, function_permissions)
VALUES
  (
    '门店端终端功能配置',
    'TERMINAL_STORE_POLICY',
    'terminal-policy',
    'store',
    'store',
    'enabled',
    '系统配置：门店端可下放功能范围',
    'store.goods.finished-stock.查询,store.goods.finished-stock.发布商品,store.goods.finished-stock.编辑,store.operation.customer.查询,store.operation.customer.新增,store.operation.order.查询,store.operation.order.开单,store.permission.employee.查询,store.permission.role.查询'
  ),
  (
    '供应商端终端功能配置',
    'TERMINAL_SUPPLIER_POLICY',
    'terminal-policy',
    'supplier',
    'store',
    'enabled',
    '系统配置：供应商端可下放功能范围',
    'supplier.goods.management.查询,supplier.goods.management.发布商品,supplier.goods.management.编辑,supplier.goods.stock.查询,supplier.fulfillment.order.查询,supplier.fulfillment.order.接单,supplier.settlement.statement.查询'
  )
ON DUPLICATE KEY UPDATE
  category = VALUES(category),
  client_code = VALUES(client_code),
  data_scope = VALUES(data_scope),
  status = VALUES(status),
  remark = VALUES(remark),
  function_permissions = VALUES(function_permissions);
