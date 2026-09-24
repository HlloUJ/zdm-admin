CREATE TABLE store_finished_products (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id BIGINT NOT NULL,
  store_id BIGINT NOT NULL,
  finished_product_id BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'warehouse',
  off_shelf_reason VARCHAR(80),
  off_shelf_detail VARCHAR(500),
  off_shelf_at DATETIME,
  selected_by_account_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_finished_product (store_id, finished_product_id),
  KEY idx_store_finished_scope_status (tenant_id, store_id, status),
  CONSTRAINT fk_store_finished_store FOREIGN KEY (store_id) REFERENCES stores (id),
  CONSTRAINT fk_store_finished_product FOREIGN KEY (finished_product_id) REFERENCES finished_products (id),
  CONSTRAINT chk_store_finished_status CHECK (status IN ('warehouse', 'selling', 'offShelf', 'recycle'))
);

CREATE TABLE store_finished_guide_prices (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  listing_id BIGINT NOT NULL,
  sku_id BIGINT NOT NULL,
  manual_price DECIMAL(12, 2) NOT NULL,
  updated_by_account_id BIGINT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_finished_guide_sku (listing_id, sku_id),
  CONSTRAINT fk_store_finished_guide_listing FOREIGN KEY (listing_id)
    REFERENCES store_finished_products (id) ON DELETE CASCADE,
  CONSTRAINT fk_store_finished_guide_sku FOREIGN KEY (sku_id)
    REFERENCES finished_product_variants (id),
  CONSTRAINT chk_store_finished_guide_price CHECK (manual_price >= 0)
);

CREATE TABLE store_finished_role_price_configurations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id BIGINT NOT NULL,
  store_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  price_coefficient DECIMAL(7, 4) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_by_account_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_finished_role_config (store_id, role_id),
  KEY idx_store_finished_role_scope (tenant_id, store_id, status),
  CONSTRAINT fk_store_finished_role_config_store FOREIGN KEY (store_id)
    REFERENCES stores (id),
  CONSTRAINT chk_store_finished_role_coefficient CHECK (price_coefficient >= 0),
  CONSTRAINT chk_store_finished_role_status CHECK (status IN ('enabled', 'disabled'))
);

CREATE TABLE store_finished_role_price_overrides (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  listing_id BIGINT NOT NULL,
  sku_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  manual_price DECIMAL(12, 2) NOT NULL,
  updated_by_account_id BIGINT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_finished_role_price (listing_id, sku_id, role_id),
  CONSTRAINT fk_store_finished_role_price_listing FOREIGN KEY (listing_id)
    REFERENCES store_finished_products (id) ON DELETE CASCADE,
  CONSTRAINT fk_store_finished_role_price_sku FOREIGN KEY (sku_id)
    REFERENCES finished_product_variants (id),
  CONSTRAINT chk_store_finished_role_price CHECK (manual_price >= 0)
);

CREATE TABLE store_finished_operation_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id BIGINT NOT NULL,
  store_id BIGINT NOT NULL,
  listing_id BIGINT,
  finished_product_id BIGINT NOT NULL,
  product_name VARCHAR(120) NOT NULL,
  operation_type VARCHAR(40) NOT NULL,
  operation_summary VARCHAR(255) NOT NULL,
  before_status VARCHAR(20),
  after_status VARCHAR(20),
  change_details JSON,
  operator_account_id BIGINT,
  operator_name VARCHAR(120) NOT NULL,
  operated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_store_finished_logs_scope_time (tenant_id, store_id, operated_at, id),
  KEY idx_store_finished_logs_product (store_id, finished_product_id, id)
);
