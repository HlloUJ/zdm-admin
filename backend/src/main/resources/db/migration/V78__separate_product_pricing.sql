CREATE TABLE slab_markup_configurations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(20) NOT NULL,
  markup_rate DECIMAL(7, 4) NOT NULL,
  sort_order INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_by_name VARCHAR(100),
  created_by_account_id BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_slab_markup_configurations_name (name),
  KEY idx_slab_markup_configurations_status_sort (status, sort_order, id),
  CONSTRAINT chk_slab_markup_configurations_rate CHECK (markup_rate >= 0),
  CONSTRAINT chk_slab_markup_configurations_sort CHECK (sort_order > 0)
);

CREATE TABLE finished_markup_configurations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(20) NOT NULL,
  markup_rate DECIMAL(7, 4) NOT NULL,
  sort_order INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_by_name VARCHAR(100),
  created_by_account_id BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_finished_markup_configurations_name (name),
  KEY idx_finished_markup_configurations_status_sort (status, sort_order, id),
  CONSTRAINT chk_finished_markup_configurations_rate CHECK (markup_rate >= 0),
  CONSTRAINT chk_finished_markup_configurations_sort CHECK (sort_order > 0)
);

INSERT INTO slab_markup_configurations
  (id, name, markup_rate, sort_order, status, created_by_name, created_by_account_id, created_at, updated_at)
SELECT
  id, name, markup_rate, sort_order, status, created_by_name, created_by_account_id, created_at, updated_at
FROM markup_configurations
WHERE product_type = 'slab';

INSERT INTO finished_markup_configurations
  (id, name, markup_rate, sort_order, status, created_by_name, created_by_account_id, created_at, updated_at)
SELECT
  id, name, markup_rate, sort_order, status, created_by_name, created_by_account_id, created_at, updated_at
FROM markup_configurations
WHERE product_type = 'finished';

CREATE TABLE slab_prices (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  slab_id BIGINT NOT NULL,
  markup_configuration_id BIGINT NOT NULL,
  markup_rate DECIMAL(7, 4) NOT NULL,
  cost_price DECIMAL(12, 2) NOT NULL,
  price DECIMAL(12, 2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_slab_prices_level (slab_id, markup_configuration_id),
  KEY idx_slab_prices_slab (slab_id, id),
  CONSTRAINT fk_slab_prices_slab FOREIGN KEY (slab_id) REFERENCES slab_inventory (id) ON DELETE CASCADE,
  CONSTRAINT fk_slab_prices_configuration
    FOREIGN KEY (markup_configuration_id) REFERENCES slab_markup_configurations (id),
  CONSTRAINT chk_slab_prices_rate CHECK (markup_rate >= 0),
  CONSTRAINT chk_slab_prices_values CHECK (cost_price >= 0 AND price >= cost_price)
);

CREATE TABLE finished_product_prices (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  finished_product_id BIGINT NOT NULL,
  variant_key VARCHAR(100) NOT NULL,
  variant_label VARCHAR(200),
  markup_configuration_id BIGINT NOT NULL,
  markup_rate DECIMAL(7, 4) NOT NULL,
  cost_price DECIMAL(12, 2) NOT NULL,
  price DECIMAL(12, 2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_finished_product_prices_level
    (finished_product_id, variant_key, markup_configuration_id),
  KEY idx_finished_product_prices_product (finished_product_id, variant_key, id),
  CONSTRAINT fk_finished_product_prices_product
    FOREIGN KEY (finished_product_id) REFERENCES finished_products (id) ON DELETE CASCADE,
  CONSTRAINT fk_finished_product_prices_configuration
    FOREIGN KEY (markup_configuration_id) REFERENCES finished_markup_configurations (id),
  CONSTRAINT chk_finished_product_prices_rate CHECK (markup_rate >= 0),
  CONSTRAINT chk_finished_product_prices_values CHECK (cost_price >= 0 AND price >= cost_price)
);

INSERT INTO slab_prices
  (slab_id, markup_configuration_id, markup_rate, cost_price, price, created_at, updated_at)
SELECT
  snapshot.product_id,
  snapshot.markup_configuration_id,
  snapshot.markup_rate_snapshot,
  snapshot.cost_price_snapshot,
  snapshot.sale_price,
  snapshot.created_at,
  snapshot.updated_at
FROM product_markup_price_snapshots snapshot
INNER JOIN slab_inventory slab ON slab.id = snapshot.product_id
WHERE snapshot.product_type = 'slab' AND snapshot.is_current = 1;

INSERT INTO finished_product_prices
  (finished_product_id, variant_key, variant_label, markup_configuration_id,
   markup_rate, cost_price, price, created_at, updated_at)
SELECT
  snapshot.product_id,
  snapshot.variant_key,
  snapshot.variant_label,
  snapshot.markup_configuration_id,
  snapshot.markup_rate_snapshot,
  snapshot.cost_price_snapshot,
  snapshot.sale_price,
  snapshot.created_at,
  snapshot.updated_at
FROM product_markup_price_snapshots snapshot
INNER JOIN finished_products product ON product.id = snapshot.product_id
WHERE snapshot.product_type = 'finished' AND snapshot.is_current = 1;

DROP TABLE product_markup_price_snapshots;
DROP TABLE markup_configurations;
