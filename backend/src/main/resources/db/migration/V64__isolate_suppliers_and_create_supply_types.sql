CREATE TABLE supplier_supply_types (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(80) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_by_name VARCHAR(80),
  created_by_account_id BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_supplier_supply_types_code (code),
  UNIQUE KEY uk_supplier_supply_types_name (name),
  KEY idx_supplier_supply_types_status_sort (status, sort_order)
);

INSERT INTO supplier_supply_types
  (id, code, name, sort_order, status, created_by_name, created_by_account_id)
VALUES
  (1, 'slab', '大板', 10, 'enabled', '系统初始化', 1),
  (2, 'finished', '成品现货', 20, 'enabled', '系统初始化', 1),
  (3, 'accessory', '配件', 30, 'enabled', '系统初始化', 1);

CREATE TABLE supplier_supply_type_links (
  supplier_id BIGINT NOT NULL,
  supply_type_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (supplier_id, supply_type_id),
  KEY idx_supplier_supply_type_links_type (supply_type_id, supplier_id),
  CONSTRAINT fk_supplier_supply_type_links_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE,
  CONSTRAINT fk_supplier_supply_type_links_type
    FOREIGN KEY (supply_type_id) REFERENCES supplier_supply_types (id)
);

INSERT INTO supplier_supply_type_links (supplier_id, supply_type_id)
SELECT s.id, st.id
FROM suppliers s
JOIN supplier_supply_types st ON st.code = s.type;

ALTER TABLE suppliers
  ADD COLUMN owner_scope VARCHAR(30) NULL AFTER id,
  ADD COLUMN owner_id BIGINT NULL AFTER owner_scope,
  ADD COLUMN tenant_id BIGINT NULL AFTER owner_id,
  ADD COLUMN store_id BIGINT NULL AFTER tenant_id,
  DROP INDEX uk_suppliers_name;

DELETE FROM suppliers
WHERE owner_scope IS NULL;

ALTER TABLE suppliers
  MODIFY COLUMN owner_scope VARCHAR(30) NOT NULL,
  MODIFY COLUMN owner_id BIGINT NOT NULL,
  DROP COLUMN type,
  ADD UNIQUE KEY uk_suppliers_owner_name (owner_scope, owner_id, name),
  ADD KEY idx_suppliers_owner_created (owner_scope, owner_id, created_at),
  ADD KEY idx_suppliers_tenant_store (tenant_id, store_id),
  ADD CONSTRAINT fk_suppliers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  ADD CONSTRAINT fk_suppliers_store FOREIGN KEY (store_id) REFERENCES stores (id),
  ADD CONSTRAINT chk_suppliers_owner_scope CHECK (
    (owner_scope = 'platform' AND owner_id = 0 AND tenant_id IS NULL AND store_id IS NULL)
    OR
    (owner_scope = 'store' AND owner_id = store_id AND tenant_id IS NOT NULL AND store_id IS NOT NULL)
  );
