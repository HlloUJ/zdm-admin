-- Retire only the five obsolete page-level price permissions. Never infer new granular grants.
UPDATE roles
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',store[.]price-configuration[.](view|create|edit|toggle-status|delete)(?=,)', ''))
WHERE function_permissions REGEXP 'store[.]price-configuration[.](view|create|edit|toggle-status|delete)(,|$)';
UPDATE terminal_function_policies
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',store[.]price-configuration[.](view|create|edit|toggle-status|delete)(?=,)', ''))
WHERE function_permissions REGEXP 'store[.]price-configuration[.](view|create|edit|toggle-status|delete)(,|$)';
DELETE FROM role_permissions WHERE permission_code IN ('store.price-configuration.view','store.price-configuration.create','store.price-configuration.edit','store.price-configuration.toggle-status','store.price-configuration.delete');
DELETE FROM permissions WHERE code IN ('store.price-configuration.view','store.price-configuration.create','store.price-configuration.edit','store.price-configuration.toggle-status','store.price-configuration.delete');
