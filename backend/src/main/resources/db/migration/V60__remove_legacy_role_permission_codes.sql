UPDATE terminal_function_policies
SET function_permissions = REPLACE(
  function_permissions,
  'admin.permission-management.role-management.partner-store.',
  'admin.permission-management.role-management.')
WHERE terminal = 'store';

UPDATE terminal_function_policies
SET function_permissions = REPLACE(
  function_permissions,
  'admin.permission-management.role-management.supplier-store.',
  'admin.permission-management.role-management.')
WHERE terminal = 'supplier';

UPDATE terminal_function_policies
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',admin[.]permission-management[.]role-management[.](operation-platform|partner-store|supplier-store)[.][^,]+',
  ''));

UPDATE roles
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',admin[.]permission-management[.]role-management[.](operation-platform|partner-store|supplier-store)[.][^,]+',
  ''));
