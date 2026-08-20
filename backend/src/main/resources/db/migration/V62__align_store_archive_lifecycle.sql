UPDATE stores
SET status = 'disabled'
WHERE status = 'archived';

UPDATE roles
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',admin[.]tenant[.]tenant-store-management([.]operating)?[.]toggle-status',
  ''));

UPDATE terminal_function_policies
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',admin[.]tenant[.]tenant-store-management([.]operating)?[.]toggle-status',
  ''));
