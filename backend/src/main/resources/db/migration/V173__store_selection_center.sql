CREATE TABLE store_selection_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id BIGINT NOT NULL,
  store_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  product_type VARCHAR(16) NOT NULL,
  product_id BIGINT NOT NULL,
  added_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_selection_owner_product (store_id, account_id, product_type, product_id),
  KEY idx_selection_owner_time (tenant_id, store_id, account_id, added_at, id)
);
CREATE TABLE store_selection_batches (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id BIGINT NOT NULL,
  store_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'processing',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at DATETIME(6) NULL,
  UNIQUE KEY uk_selection_batch_request (store_id, account_id, request_id)
);
CREATE TABLE store_selection_batch_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  batch_id BIGINT NOT NULL,
  selection_id BIGINT NOT NULL,
  product_type VARCHAR(16) NOT NULL,
  product_id BIGINT NOT NULL,
  product_name VARCHAR(512) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  error_code VARCHAR(40) NULL,
  reason VARCHAR(512) NULL,
  listing_id BIGINT NULL,
  UNIQUE KEY uk_selection_batch_product (batch_id, product_type, product_id),
  CONSTRAINT fk_selection_batch_item FOREIGN KEY (batch_id) REFERENCES store_selection_batches(id)
);
