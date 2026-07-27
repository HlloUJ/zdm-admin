CREATE TABLE platform_clients (
  code VARCHAR(40) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE accounts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  phone VARCHAR(20) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  account_type VARCHAR(30) NOT NULL DEFAULT 'person',
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_accounts_phone (phone)
);

CREATE TABLE account_identities (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  account_id BIGINT NOT NULL,
  client_code VARCHAR(40) NOT NULL,
  identity_type VARCHAR(40) NOT NULL,
  subject_id BIGINT,
  tenant_id BIGINT,
  store_id BIGINT,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_account_identity (account_id, client_code, identity_type, subject_id),
  KEY idx_account_identities_tenant_id (tenant_id),
  KEY idx_account_identities_store_id (store_id),
  CONSTRAINT fk_account_identities_account FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT fk_account_identities_client FOREIGN KEY (client_code) REFERENCES platform_clients (code),
  CONSTRAINT fk_account_identities_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_account_identities_store FOREIGN KEY (store_id) REFERENCES stores (id)
);

CREATE TABLE permissions (
  code VARCHAR(100) PRIMARY KEY,
  client_code VARCHAR(40) NOT NULL,
  name VARCHAR(100) NOT NULL,
  module VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_permissions_client FOREIGN KEY (client_code) REFERENCES platform_clients (code)
);

CREATE TABLE role_permissions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  role_id BIGINT NOT NULL,
  permission_code VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_role_permission (role_id, permission_code),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_code) REFERENCES permissions (code)
);

CREATE TABLE account_roles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  account_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  client_code VARCHAR(40) NOT NULL,
  tenant_id BIGINT,
  store_id BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_account_role_scope (account_id, role_id, client_code, tenant_id, store_id),
  CONSTRAINT fk_account_roles_account FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT fk_account_roles_role FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT fk_account_roles_client FOREIGN KEY (client_code) REFERENCES platform_clients (code),
  CONSTRAINT fk_account_roles_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_account_roles_store FOREIGN KEY (store_id) REFERENCES stores (id)
);

ALTER TABLE employees ADD COLUMN account_id BIGINT AFTER id;
ALTER TABLE employees ADD CONSTRAINT fk_employees_account FOREIGN KEY (account_id) REFERENCES accounts (id);

INSERT INTO platform_clients (code, name, status)
VALUES
  ('admin', '管理后台', 'enabled'),
  ('customer', 'C端用户', 'enabled'),
  ('designer', '设计师端', 'enabled'),
  ('guide', '门店导购端', 'enabled');

INSERT INTO accounts (id, phone, display_name, account_type, status)
VALUES (1, '13800000000', '系统管理员', 'person', 'enabled');

UPDATE employees SET account_id = 1 WHERE id = 1;

INSERT INTO account_identities (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
VALUES (1, 'admin', 'platform_admin', 1, 1, 1, 'enabled');

INSERT INTO permissions (code, client_code, name, module, status)
VALUES
  ('admin:tenant:manage', 'admin', '租户管理', 'tenant', 'enabled'),
  ('admin:store:manage', 'admin', '门店管理', 'store', 'enabled'),
  ('admin:role:manage', 'admin', '角色管理', 'role', 'enabled'),
  ('admin:employee:manage', 'admin', '员工管理', 'employee', 'enabled');

INSERT INTO role_permissions (role_id, permission_code)
VALUES
  (1, 'admin:tenant:manage'),
  (1, 'admin:store:manage'),
  (1, 'admin:role:manage'),
  (1, 'admin:employee:manage');

INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
VALUES (1, 1, 'admin', 1, 1);
