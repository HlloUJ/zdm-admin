CREATE TABLE slab_guide_price_settings (
  id BIGINT PRIMARY KEY,
  price_coefficient DECIMAL(7, 4) NOT NULL,
  updated_by_name VARCHAR(100),
  updated_by_account_id BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_slab_guide_price_settings_coefficient CHECK (price_coefficient >= 0)
);

CREATE TABLE finished_guide_price_settings (
  id BIGINT PRIMARY KEY,
  price_coefficient DECIMAL(7, 4) NOT NULL,
  updated_by_name VARCHAR(100),
  updated_by_account_id BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_finished_guide_price_settings_coefficient CHECK (price_coefficient >= 0)
);

ALTER TABLE slab_inventory
  ADD COLUMN guide_price_coefficient DECIMAL(7, 4) NULL AFTER guide_price;

UPDATE slab_inventory
SET guide_price_coefficient = ROUND(guide_price / cost_price, 4)
WHERE guide_price IS NOT NULL AND cost_price IS NOT NULL AND cost_price > 0;

UPDATE slab_inventory inventory
INNER JOIN slab_prices price ON price.slab_id = inventory.id
INNER JOIN slab_markup_configurations configuration
  ON configuration.id = price.markup_configuration_id AND configuration.name = '指导价'
SET inventory.guide_price_coefficient = CASE
      WHEN price.cost_price > 0 THEN ROUND(price.price / price.cost_price, 4)
      ELSE price.price_coefficient
    END,
    inventory.guide_price = price.price;

CREATE TABLE finished_product_guide_prices (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  finished_product_id BIGINT NOT NULL,
  variant_key VARCHAR(100) NOT NULL,
  variant_label VARCHAR(200),
  price_coefficient DECIMAL(7, 4) NOT NULL,
  cost_price DECIMAL(12, 2) NOT NULL,
  price DECIMAL(12, 2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_finished_product_guide_prices_variant (finished_product_id, variant_key),
  KEY idx_finished_product_guide_prices_product (finished_product_id, id),
  CONSTRAINT fk_finished_product_guide_prices_product
    FOREIGN KEY (finished_product_id) REFERENCES finished_products (id) ON DELETE CASCADE,
  CONSTRAINT chk_finished_product_guide_prices_coefficient CHECK (price_coefficient >= 0),
  CONSTRAINT chk_finished_product_guide_prices_values CHECK (cost_price >= 0 AND price >= 0)
);

INSERT INTO finished_product_guide_prices
  (finished_product_id, variant_key, variant_label, price_coefficient, cost_price, price, created_at, updated_at)
SELECT
  price.finished_product_id,
  price.variant_key,
  price.variant_label,
  CASE
    WHEN price.cost_price > 0 THEN ROUND(price.price / price.cost_price, 4)
    ELSE price.price_coefficient
  END,
  price.cost_price,
  price.price,
  price.created_at,
  price.updated_at
FROM finished_product_prices price
INNER JOIN finished_markup_configurations configuration
  ON configuration.id = price.markup_configuration_id
WHERE configuration.name = '指导价';

DELETE price
FROM finished_product_prices price
INNER JOIN finished_markup_configurations configuration
  ON configuration.id = price.markup_configuration_id
WHERE configuration.name = '指导价';

DELETE price
FROM slab_prices price
INNER JOIN slab_markup_configurations configuration
  ON configuration.id = price.markup_configuration_id
WHERE configuration.name = '指导价';

DELETE FROM finished_markup_configurations WHERE name = '指导价';
DELETE FROM slab_markup_configurations WHERE name = '指导价';

DELETE configuration
FROM finished_markup_configurations configuration
LEFT JOIN finished_product_prices price ON price.markup_configuration_id = configuration.id
WHERE price.id IS NULL
  AND configuration.created_by_account_id = 1
  AND configuration.created_by_name = '韩健'
  AND configuration.name IN ('1级合伙人价格', '2级合伙人价格', '3级合伙人价格');

DELETE configuration
FROM slab_markup_configurations configuration
LEFT JOIN slab_prices price ON price.markup_configuration_id = configuration.id
WHERE price.id IS NULL
  AND configuration.created_by_account_id = 1
  AND configuration.created_by_name = '韩健'
  AND configuration.name IN ('1级合伙人价格', '2级合伙人价格', '3级合伙人价格');
