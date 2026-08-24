UPDATE roles
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',admin[.]slab-management[.](warehouse[.]reject|selling[.]delete|rejected[.]view)',
  ''));

UPDATE terminal_function_policies
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',admin[.]slab-management[.](warehouse[.]reject|selling[.]delete|rejected[.]view)',
  ''));
