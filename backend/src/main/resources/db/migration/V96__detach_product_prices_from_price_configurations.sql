ALTER TABLE slab_prices
  ADD COLUMN store_level_id BIGINT NULL AFTER slab_id;

UPDATE slab_prices price
INNER JOIN slab_markup_configurations configuration
  ON configuration.id = price.markup_configuration_id
SET price.store_level_id = configuration.store_level_id;

ALTER TABLE slab_prices
  DROP FOREIGN KEY fk_slab_prices_configuration,
  DROP INDEX uk_slab_prices_level,
  DROP COLUMN markup_configuration_id,
  MODIFY COLUMN store_level_id BIGINT NOT NULL,
  ADD UNIQUE KEY uk_slab_prices_store_level (slab_id, store_level_id),
  ADD CONSTRAINT fk_slab_prices_store_level
    FOREIGN KEY (store_level_id) REFERENCES store_levels(id);

ALTER TABLE finished_product_prices
  ADD COLUMN store_level_id BIGINT NULL AFTER finished_product_id;

UPDATE finished_product_prices price
INNER JOIN finished_markup_configurations configuration
  ON configuration.id = price.markup_configuration_id
SET price.store_level_id = configuration.store_level_id;

ALTER TABLE finished_product_prices
  DROP FOREIGN KEY fk_finished_product_prices_configuration,
  DROP INDEX uk_finished_product_prices_level,
  DROP COLUMN markup_configuration_id,
  MODIFY COLUMN store_level_id BIGINT NOT NULL,
  ADD UNIQUE KEY uk_finished_product_prices_store_level
    (finished_product_id, variant_key, store_level_id),
  ADD CONSTRAINT fk_finished_product_prices_store_level
    FOREIGN KEY (store_level_id) REFERENCES store_levels(id);
