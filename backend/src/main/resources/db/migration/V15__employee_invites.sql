ALTER TABLE employees DROP INDEX uk_employees_phone;
ALTER TABLE employees ADD INDEX idx_employees_phone (phone);
ALTER TABLE employees ADD INDEX idx_employees_account_scope (account_id, tenant_id, store_id);

CREATE TABLE employee_invites (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  token VARCHAR(80) NOT NULL,
  tenant_id BIGINT NOT NULL,
  store_id BIGINT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_employee_invites_token (token),
  KEY idx_employee_invites_scope (tenant_id, store_id),
  CONSTRAINT fk_employee_invites_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_employee_invites_store FOREIGN KEY (store_id) REFERENCES stores (id)
);

INSERT INTO account_identities (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
VALUES (1, 'admin', 'employee', 1, 1, 1, 'enabled')
ON DUPLICATE KEY UPDATE
  tenant_id = VALUES(tenant_id),
  store_id = VALUES(store_id),
  status = VALUES(status);
