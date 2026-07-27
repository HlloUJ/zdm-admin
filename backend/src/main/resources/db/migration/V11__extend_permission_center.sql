ALTER TABLE roles ADD COLUMN category VARCHAR(40) AFTER code;
ALTER TABLE roles ADD COLUMN client_code VARCHAR(40) AFTER category;
ALTER TABLE roles ADD COLUMN function_permissions TEXT AFTER remark;

ALTER TABLE employees ADD COLUMN gender VARCHAR(20) AFTER name;
ALTER TABLE employees ADD COLUMN role_ids VARCHAR(255) AFTER status;
ALTER TABLE employees ADD COLUMN data_permission VARCHAR(30) AFTER role_ids;
ALTER TABLE employees ADD COLUMN remark VARCHAR(255) AFTER data_permission;

UPDATE roles
SET category = 'operation-platform',
    client_code = 'admin',
    function_permissions = 'all'
WHERE id = 1;

UPDATE employees
SET gender = 'male',
    role_ids = '1',
    data_permission = 'all',
    remark = '系统初始化员工'
WHERE id = 1;

INSERT INTO roles (id, name, code, category, client_code, data_scope, status, remark, function_permissions)
VALUES
  (2, '管理员', 'ADMIN_MANAGER', 'operation-platform', 'admin', 'all', 'enabled', '负责基础配置与账号维护',
   'admin.tenant.tenant-management.query,admin.tenant.tenant-store-management.query,admin.permission-management.employee-management.query,admin.permission-management.employee-management.create,admin.permission-management.employee-management.edit,admin.permission-management.role-management.create,admin.permission-management.role-management.permission,admin.product-data-center.attribute.query,admin.product-data-center.attribute.create,admin.product-data-center.attribute-value.query,admin.product-data-center.attribute-value.create'),
  (3, '运营', 'OPERATOR', 'operation-platform', 'admin', 'self', 'enabled', '负责商品运营与供应商协同',
   'admin.finished-stock-management.warehouse.query,admin.finished-stock-management.warehouse.publish,admin.finished-stock-management.selling.query,admin.slab-management.warehouse.query,admin.supplier-management.query,admin.product-data-center.category.query'),
  (4, '客服', 'CUSTOMER_SERVICE', 'operation-platform', 'admin', 'self', 'enabled', '负责客户服务处理',
   'admin.tenant.tenant-management.query,admin.tenant.tenant-store-management.query,admin.finished-stock-management.selling.query,admin.supplier-management.query'),
  (101, '店长', 'PARTNER_STORE_MANAGER', 'partner-store', 'store', 'store', 'enabled', '负责门店经营管理', ''),
  (102, '门店导购', 'PARTNER_STORE_GUIDE', 'partner-store', 'guide', 'store', 'enabled', '负责客户接待与产品介绍', ''),
  (103, '驻店设计师', 'PARTNER_STORE_DESIGNER', 'partner-store', 'designer', 'store', 'enabled', '负责方案设计与深化沟通', ''),
  (104, '安装工人', 'PARTNER_STORE_INSTALLER', 'partner-store', 'installer', 'store', 'enabled', '负责安装履约', ''),
  (201, '店长', 'SUPPLIER_STORE_MANAGER', 'supplier-store', 'supplier', 'store', 'enabled', '负责供应商门店运营', ''),
  (202, '门店导购', 'SUPPLIER_STORE_GUIDE', 'supplier-store', 'guide', 'store', 'enabled', '负责供应商门店客户接待', ''),
  (203, '驻店设计师', 'SUPPLIER_STORE_DESIGNER', 'supplier-store', 'designer', 'store', 'enabled', '负责供应商门店设计支持', ''),
  (204, '安装工人', 'SUPPLIER_STORE_INSTALLER', 'supplier-store', 'installer', 'store', 'enabled', '负责供应商门店安装履约', '')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  category = VALUES(category),
  client_code = VALUES(client_code),
  data_scope = VALUES(data_scope),
  status = VALUES(status),
  remark = VALUES(remark),
  function_permissions = VALUES(function_permissions);
