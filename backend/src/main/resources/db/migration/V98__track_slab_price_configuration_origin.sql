ALTER TABLE slab_prices
  ADD COLUMN price_source VARCHAR(20) NOT NULL DEFAULT 'manual' AFTER price,
  ADD COLUMN source_configuration_id BIGINT NULL AFTER price_source,
  ADD COLUMN manual_updated_by_name VARCHAR(80) NULL AFTER source_configuration_id,
  ADD COLUMN manual_updated_by_account_id BIGINT NULL AFTER manual_updated_by_name,
  ADD COLUMN manual_updated_at DATETIME NULL AFTER manual_updated_by_account_id;

UPDATE slab_prices price
INNER JOIN slab_markup_configurations configuration
  ON configuration.store_level_id = price.store_level_id
SET price.price_source = 'auto',
    price.source_configuration_id = configuration.id
WHERE configuration.status = 'enabled'
  AND price.price_coefficient = configuration.price_coefficient
  AND price.price = ROUND(price.cost_price * configuration.price_coefficient, 2);

ALTER TABLE slab_prices
  ADD KEY idx_slab_prices_source_configuration (source_configuration_id, price_source),
  ADD CONSTRAINT fk_slab_prices_source_configuration
    FOREIGN KEY (source_configuration_id) REFERENCES slab_markup_configurations(id),
  ADD CONSTRAINT chk_slab_prices_source CHECK (
    (price_source = 'auto' AND source_configuration_id IS NOT NULL)
    OR (price_source = 'manual' AND source_configuration_id IS NULL)
  );
