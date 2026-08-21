CREATE TABLE tenant_businesses (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id BIGINT NOT NULL,
  business_type VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_tenant_business (tenant_id, business_type),
  KEY idx_tenant_business_status (tenant_id, status),
  CONSTRAINT fk_tenant_business_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

INSERT INTO tenant_businesses (tenant_id, business_type, status)
SELECT id, 'cityPartner', 'enabled' FROM tenants WHERE FIND_IN_SET('cityPartner', business_types)
UNION ALL
SELECT id, 'slabSupplier', 'enabled' FROM tenants WHERE FIND_IN_SET('slabSupplier', business_types)
UNION ALL
SELECT id, 'finishedSupplier', 'enabled' FROM tenants WHERE FIND_IN_SET('finishedSupplier', business_types)
UNION ALL
SELECT id, 'factory', 'enabled' FROM tenants WHERE FIND_IN_SET('factory', business_types);

ALTER TABLE roles ALTER COLUMN store_id SET DEFAULT NULL;

UPDATE roles
SET store_id = NULL
WHERE category IN ('operation-platform', 'terminal-policy');

UPDATE account_roles ar
JOIN roles r ON r.id = ar.role_id
SET ar.tenant_id = NULL,
    ar.store_id = NULL
WHERE r.category = 'operation-platform';

UPDATE employees e
SET e.tenant_id = NULL,
    e.store_id = NULL
WHERE EXISTS (
  SELECT 1
  FROM account_roles ar
  JOIN roles r ON r.id = ar.role_id
  WHERE ar.account_id = e.account_id
    AND r.category = 'operation-platform'
);

UPDATE account_identities ai
JOIN employees e ON e.id = ai.subject_id AND ai.identity_type = 'employee'
SET ai.tenant_id = e.tenant_id,
    ai.store_id = e.store_id;

UPDATE account_identities
SET tenant_id = NULL,
    store_id = NULL
WHERE identity_type = 'platform_admin';

INSERT INTO account_identities
  (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
SELECT a.id, 'admin', 'tenant_admin', t.id, t.id, NULL, t.status
FROM tenants t
JOIN accounts a ON a.phone = t.contact_phone
ON DUPLICATE KEY UPDATE status = VALUES(status);

INSERT INTO account_identities
  (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
SELECT tenant_admin.account_id, 'admin', 'store_admin', s.id, s.tenant_id, s.id, s.status
FROM stores s
JOIN account_identities tenant_admin
  ON tenant_admin.identity_type = 'tenant_admin'
 AND tenant_admin.tenant_id = s.tenant_id
ON DUPLICATE KEY UPDATE status = VALUES(status);

DELETE rp
FROM role_permissions rp
JOIN permissions p ON p.code = rp.permission_code
WHERE p.code = 'admin:order:manage';

DELETE FROM permissions WHERE code = 'admin:order:manage';

DROP TABLE platform_orders;
