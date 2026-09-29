-- Product editing now uses each active tab's edit action; read-only states use detail.
-- Do not convert a former price grant into edit: edit has a broader business meaning.
DELETE FROM role_permissions
WHERE permission_code REGEXP '^(admin[.](finished-stock-management|slab-management)[.](warehouse|selling)[.](price|detail)|admin[.](finished-stock-management|slab-management)[.](sold-out|recycle)[.]price|supply-chain[.](finished-stock-management|slab-management)[.](warehouse|selling|off-shelf|sold-out|recycle)[.]price|store[.]finished-stock-management[.](warehouse|selling)[.](price|detail)|store[.]finished-stock-management[.](sold-out|recycle)[.]price)$';

UPDATE roles
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',(admin[.](finished-stock-management|slab-management)[.](warehouse|selling)[.](price|detail)|admin[.](finished-stock-management|slab-management)[.](sold-out|recycle)[.]price|supply-chain[.](finished-stock-management|slab-management)[.](warehouse|selling|off-shelf|sold-out|recycle)[.]price|store[.]finished-stock-management[.](warehouse|selling)[.](price|detail)|store[.]finished-stock-management[.](sold-out|recycle)[.]price)',
  ''))
WHERE function_permissions REGEXP '(finished-stock-management|slab-management)';

UPDATE terminal_function_policies
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',(admin[.](finished-stock-management|slab-management)[.](warehouse|selling)[.](price|detail)|admin[.](finished-stock-management|slab-management)[.](sold-out|recycle)[.]price|supply-chain[.](finished-stock-management|slab-management)[.](warehouse|selling|off-shelf|sold-out|recycle)[.]price|store[.]finished-stock-management[.](warehouse|selling)[.](price|detail)|store[.]finished-stock-management[.](sold-out|recycle)[.]price)',
  ''))
WHERE function_permissions REGEXP '(finished-stock-management|slab-management)';
