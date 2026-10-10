-- 折扣系数不提供批量设置；保留现有折扣记录及单条维护所需字段。
UPDATE roles
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', function_permissions, ','),
  ',store[.]price-configuration[.]discount[.](finished|accessory)[.]batch-set(?=,)', ''))
WHERE FIND_IN_SET('store.price-configuration.discount.finished.batch-set', function_permissions) > 0
   OR FIND_IN_SET('store.price-configuration.discount.accessory.batch-set', function_permissions) > 0;

UPDATE terminal_function_policies
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', function_permissions, ','),
  ',store[.]price-configuration[.]discount[.](finished|accessory)[.]batch-set(?=,)', ''))
WHERE FIND_IN_SET('store.price-configuration.discount.finished.batch-set', function_permissions) > 0
   OR FIND_IN_SET('store.price-configuration.discount.accessory.batch-set', function_permissions) > 0;

DELETE FROM role_permissions
WHERE permission_code IN ('store.price-configuration.discount.finished.batch-set',
  'store.price-configuration.discount.accessory.batch-set');

DELETE FROM permissions
WHERE code IN ('store.price-configuration.discount.finished.batch-set',
  'store.price-configuration.discount.accessory.batch-set');

