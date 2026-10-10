-- 终端功能分配仅运营平台超级管理员可访问，不再作为可授权功能；保留终端已下放配置。
UPDATE roles
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', function_permissions, ','),
  ',admin[.]permission-management[.]terminal-function-allocation[.](view|save)(?=,)', ''))
WHERE FIND_IN_SET('admin.permission-management.terminal-function-allocation.view', function_permissions) > 0
   OR FIND_IN_SET('admin.permission-management.terminal-function-allocation.save', function_permissions) > 0;

UPDATE terminal_function_policies
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', function_permissions, ','),
  ',admin[.]permission-management[.]terminal-function-allocation[.](view|save)(?=,)', ''))
WHERE FIND_IN_SET('admin.permission-management.terminal-function-allocation.view', function_permissions) > 0
   OR FIND_IN_SET('admin.permission-management.terminal-function-allocation.save', function_permissions) > 0;

DELETE FROM role_permissions
WHERE permission_code IN ('admin.permission-management.terminal-function-allocation.view',
  'admin.permission-management.terminal-function-allocation.save');

DELETE FROM permissions
WHERE code IN ('admin.permission-management.terminal-function-allocation.view',
  'admin.permission-management.terminal-function-allocation.save');
