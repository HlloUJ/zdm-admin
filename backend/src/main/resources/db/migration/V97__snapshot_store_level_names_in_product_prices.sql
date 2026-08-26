ALTER TABLE slab_prices
  ADD COLUMN store_level_name VARCHAR(120) NULL AFTER store_level_id;

UPDATE slab_prices price
INNER JOIN store_levels level ON level.id = price.store_level_id
SET price.store_level_name = level.name;

ALTER TABLE slab_prices
  DROP FOREIGN KEY fk_slab_prices_store_level,
  MODIFY COLUMN store_level_name VARCHAR(120) NOT NULL;

ALTER TABLE finished_product_prices
  ADD COLUMN store_level_name VARCHAR(120) NULL AFTER store_level_id;

UPDATE finished_product_prices price
INNER JOIN store_levels level ON level.id = price.store_level_id
SET price.store_level_name = level.name;

ALTER TABLE finished_product_prices
  DROP FOREIGN KEY fk_finished_product_prices_store_level,
  MODIFY COLUMN store_level_name VARCHAR(120) NOT NULL;
