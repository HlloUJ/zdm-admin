CREATE TABLE markup_configurations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  product_type VARCHAR(20) NOT NULL,
  name VARCHAR(20) NOT NULL,
  markup_rate DECIMAL(7, 4) NOT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_by_name VARCHAR(100),
  created_by_account_id BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_markup_configurations_type_name (product_type, name),
  KEY idx_markup_configurations_type_status_sort (product_type, status, sort_order, id),
  CONSTRAINT chk_markup_configurations_product_type CHECK (product_type IN ('finished', 'slab')),
  CONSTRAINT chk_markup_configurations_rate CHECK (markup_rate >= 0),
  CONSTRAINT chk_markup_configurations_sort CHECK (sort_order > 0)
);

CREATE TABLE product_markup_price_snapshots (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  product_type VARCHAR(20) NOT NULL,
  product_id BIGINT NOT NULL,
  variant_key VARCHAR(100) NOT NULL DEFAULT '',
  variant_label VARCHAR(200),
  snapshot_version BIGINT NOT NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  markup_configuration_id BIGINT NOT NULL,
  markup_name_snapshot VARCHAR(20) NOT NULL,
  markup_rate_snapshot DECIMAL(7, 4) NOT NULL,
  cost_price_snapshot DECIMAL(12, 2) NOT NULL,
  sale_price DECIMAL(12, 2) NOT NULL,
  sort_order_snapshot INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_product_markup_snapshot
    (product_type, product_id, variant_key, markup_configuration_id, snapshot_version),
  KEY idx_product_markup_snapshot_product
    (product_type, product_id, is_current, variant_key, sort_order_snapshot, id),
  CONSTRAINT fk_product_markup_snapshot_configuration
    FOREIGN KEY (markup_configuration_id) REFERENCES markup_configurations (id),
  CONSTRAINT chk_product_markup_snapshot_product_type CHECK (product_type IN ('finished', 'slab')),
  CONSTRAINT chk_product_markup_snapshot_rate CHECK (markup_rate_snapshot >= 0),
  CONSTRAINT chk_product_markup_snapshot_prices CHECK (cost_price_snapshot >= 0 AND sale_price >= cost_price_snapshot)
);

INSERT INTO markup_configurations
  (product_type, name, markup_rate, sort_order, status, created_by_name, created_by_account_id)
VALUES
  ('finished', '指导价', 20.0000, 1, 'enabled', '韩健', 1),
  ('finished', '1级合伙人价格', 10.0000, 2, 'enabled', '韩健', 1),
  ('finished', '2级合伙人价格', 5.0000, 3, 'enabled', '韩健', 1),
  ('finished', '3级合伙人价格', 0.0000, 4, 'enabled', '韩健', 1),
  ('slab', '指导价', 60.0000, 1, 'enabled', '韩健', 1),
  ('slab', '1级合伙人价格', 45.0000, 2, 'enabled', '韩健', 1),
  ('slab', '2级合伙人价格', 30.0000, 3, 'enabled', '韩健', 1),
  ('slab', '3级合伙人价格', 18.0000, 4, 'enabled', '韩健', 1);
