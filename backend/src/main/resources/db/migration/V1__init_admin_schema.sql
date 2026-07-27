CREATE TABLE tenants (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  contact_name VARCHAR(50) NOT NULL,
  contact_phone VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_tenants_name (name)
);

CREATE TABLE stores (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id BIGINT NOT NULL,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(30) NOT NULL,
  region VARCHAR(120),
  address VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_stores_tenant_id (tenant_id),
  CONSTRAINT fk_stores_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

CREATE TABLE roles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  code VARCHAR(80) NOT NULL,
  data_scope VARCHAR(30) NOT NULL DEFAULT 'all',
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  remark VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_roles_code (code)
);

CREATE TABLE employees (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id BIGINT,
  store_id BIGINT,
  name VARCHAR(80) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_employees_phone (phone),
  KEY idx_employees_tenant_id (tenant_id),
  KEY idx_employees_store_id (store_id),
  CONSTRAINT fk_employees_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_employees_store FOREIGN KEY (store_id) REFERENCES stores (id)
);

INSERT INTO tenants (id, name, contact_name, contact_phone, status)
VALUES (1, '装点猫直营租户', '系统管理员', '13800000000', 'enabled');

INSERT INTO stores (id, tenant_id, name, type, region, address, status)
VALUES (1, 1, '杭州体验门店', 'direct', '浙江省杭州市', '样例地址 1 号', 'enabled');

INSERT INTO roles (id, name, code, data_scope, status, remark)
VALUES (1, '超级管理员', 'ADMIN', 'all', 'enabled', '系统初始化角色');

INSERT INTO employees (id, tenant_id, store_id, name, phone, status)
VALUES (1, 1, 1, '系统管理员', '13800000000', 'enabled');
