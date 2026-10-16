-- Retire the removed measurement-unit module only. Applied migrations remain immutable.
UPDATE roles
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',admin[.]product-data-center[.]master-data([.][^,]+)?(?=,)', ''))
WHERE function_permissions REGEXP '(^|,)admin[.]product-data-center[.]master-data([.]|,|$)';

UPDATE terminal_function_policies
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',admin[.]product-data-center[.]master-data([.][^,]+)?(?=,)', ''))
WHERE function_permissions REGEXP '(^|,)admin[.]product-data-center[.]master-data([.]|,|$)';

DELETE FROM role_permissions
WHERE permission_code REGEXP '^admin[.]product-data-center[.]master-data([.]|$)';
DELETE FROM permissions
WHERE code REGEXP '^admin[.]product-data-center[.]master-data([.]|$)';

-- This table was used exclusively by the retired module; no business tables reference it.
DROP TABLE IF EXISTS master_data;
