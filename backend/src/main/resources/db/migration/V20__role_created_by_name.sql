ALTER TABLE roles ADD COLUMN created_by_name VARCHAR(80) AFTER function_permissions;

UPDATE roles
SET created_by_name = '韩健'
WHERE code IN ('SUPER_ADMIN', 'ADMIN_MANAGER', 'OPERATOR')
  AND (created_by_name IS NULL OR created_by_name = '');

DELETE FROM roles
WHERE code = 'CUSTOMER_SERVICE'
  AND NOT EXISTS (
    SELECT 1
    FROM account_roles
    WHERE account_roles.role_id = roles.id
  );

UPDATE roles
SET status = 'disabled'
WHERE code = 'CUSTOMER_SERVICE';
