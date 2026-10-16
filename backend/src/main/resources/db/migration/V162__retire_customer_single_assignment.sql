-- Only the retired standalone customer assignment permissions are removed.
-- Keep edit, batch assignment, view and all unrelated grants unchanged; do not grant edit implicitly.
UPDATE roles
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',store[.]customer-management[.](daily|archived)[.]assign(?=,)', ''))
WHERE FIND_IN_SET('store.customer-management.daily.assign', function_permissions) > 0
   OR FIND_IN_SET('store.customer-management.archived.assign', function_permissions) > 0;
UPDATE terminal_function_policies
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',store[.]customer-management[.](daily|archived)[.]assign(?=,)', ''))
WHERE FIND_IN_SET('store.customer-management.daily.assign', function_permissions) > 0
   OR FIND_IN_SET('store.customer-management.archived.assign', function_permissions) > 0;
DELETE FROM role_permissions
WHERE permission_code IN ('store.customer-management.daily.assign','store.customer-management.archived.assign');
DELETE FROM permissions
WHERE code IN ('store.customer-management.daily.assign','store.customer-management.archived.assign');
