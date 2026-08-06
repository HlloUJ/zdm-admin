CREATE TABLE store_categories (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  parent_id BIGINT,
  name VARCHAR(20) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  product_count INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  parent_scope_key BIGINT
    GENERATED ALWAYS AS (COALESCE(parent_id, 0)) STORED,
  CONSTRAINT uk_store_categories_parent_name UNIQUE (parent_scope_key, name),
  KEY idx_store_categories_parent_sort (parent_id, sort_order),
  CONSTRAINT fk_store_categories_parent
    FOREIGN KEY (parent_id) REFERENCES store_categories (id)
);
