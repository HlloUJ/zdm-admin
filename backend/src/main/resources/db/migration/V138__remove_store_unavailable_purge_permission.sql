DELETE FROM role_permissions
WHERE permission_code = 'store.finished-stock-management.unavailable.purge';

UPDATE roles
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',store[.]finished-stock-management[.]unavailable[.]purge',
  ''))
WHERE FIND_IN_SET('store.finished-stock-management.unavailable.purge', function_permissions) > 0;

UPDATE terminal_function_policies
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',store[.]finished-stock-management[.]unavailable[.]purge',
  ''))
WHERE FIND_IN_SET('store.finished-stock-management.unavailable.purge', function_permissions) > 0;
