CREATE TABLE terminal_function_policies (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  terminal VARCHAR(20) NOT NULL,
  function_permissions TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_terminal_function_policies_terminal (terminal),
  CONSTRAINT chk_terminal_function_policies_terminal CHECK (terminal IN ('store', 'supplier'))
);

INSERT INTO terminal_function_policies (terminal, function_permissions, created_at, updated_at)
SELECT
  CASE WHEN code = 'TERMINAL_STORE_POLICY' THEN 'store' ELSE 'supplier' END,
  function_permissions,
  created_at,
  updated_at
FROM roles
WHERE category = 'terminal-policy'
  AND code IN ('TERMINAL_STORE_POLICY', 'TERMINAL_SUPPLIER_POLICY')
ON DUPLICATE KEY UPDATE
  function_permissions = VALUES(function_permissions),
  updated_at = VALUES(updated_at);

UPDATE roles
SET function_permissions = REPLACE(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(function_permissions,
          'admin.permission-management.role-management.operation-platform.view',
          'admin.permission-management.role-management.view'),
        'admin.permission-management.role-management.operation-platform.create',
        'admin.permission-management.role-management.create'),
      'admin.permission-management.role-management.operation-platform.edit',
      'admin.permission-management.role-management.edit'),
    'admin.permission-management.role-management.operation-platform.permission',
    'admin.permission-management.role-management.permission'),
  'admin.permission-management.role-management.operation-platform.delete',
  'admin.permission-management.role-management.delete')
WHERE function_permissions LIKE '%admin.permission-management.role-management.operation-platform.%';

UPDATE employees
SET role_ids = NULL
WHERE store_id IS NOT NULL;

DELETE account_roles
FROM account_roles
JOIN roles ON roles.id = account_roles.role_id
WHERE roles.category <> 'operation-platform';

DELETE role_permissions
FROM role_permissions
JOIN roles ON roles.id = role_permissions.role_id
WHERE roles.category <> 'operation-platform';

DELETE FROM roles WHERE category <> 'operation-platform';

UPDATE roles
SET data_scope = 'all';

ALTER TABLE roles
  DROP FOREIGN KEY fk_roles_store,
  DROP INDEX uk_roles_store_category_name,
  DROP INDEX idx_roles_store_category,
  DROP COLUMN store_scope_key,
  DROP COLUMN store_id,
  DROP COLUMN client_code,
  DROP COLUMN category,
  ADD UNIQUE KEY uk_roles_name (name);
