SET SESSION group_concat_max_len = 1048576;

WITH permission_items AS (
  SELECT
    roles.id,
    TRIM(items.permission_code) AS permission_code
  FROM roles
  JOIN JSON_TABLE(
    CONCAT('["', REPLACE(COALESCE(roles.function_permissions, ''), ',', '","'), '"]'),
    '$[*]' COLUMNS(permission_code VARCHAR(512) PATH '$')
  ) AS items ON TRUE
  WHERE TRIM(items.permission_code) <> ''
),
canonical_permissions AS (
  SELECT
    id,
    CASE
      WHEN SUBSTRING_INDEX(permission_code, '.', -1) IN ('query', '查询')
        THEN CONCAT(
          LEFT(
            permission_code,
            LENGTH(permission_code) - LENGTH(SUBSTRING_INDEX(permission_code, '.', -1)) - 1
          ),
          '.view'
        )
      ELSE permission_code
    END AS permission_code
  FROM permission_items
  WHERE SUBSTRING_INDEX(permission_code, '.', -1) NOT IN ('reset', '重置')
),
permissions_with_required_view AS (
  SELECT id, permission_code
  FROM canonical_permissions

  UNION ALL

  SELECT
    id,
    CONCAT(
      LEFT(
        permission_code,
        LENGTH(permission_code) - LENGTH(SUBSTRING_INDEX(permission_code, '.', -1)) - 1
      ),
      '.view'
    )
  FROM canonical_permissions
  WHERE permission_code <> 'all'
    AND permission_code LIKE '%.%'
    AND SUBSTRING_INDEX(permission_code, '.', -1) <> 'view'
),
normalized_roles AS (
  SELECT
    id,
    CASE
      WHEN SUM(permission_code = 'all') > 0 THEN 'all'
      ELSE GROUP_CONCAT(DISTINCT permission_code ORDER BY permission_code SEPARATOR ',')
    END AS function_permissions
  FROM permissions_with_required_view
  GROUP BY id
)
UPDATE roles
JOIN normalized_roles ON normalized_roles.id = roles.id
SET roles.function_permissions = normalized_roles.function_permissions;
