ALTER TABLE finished_product_prices
  ADD COLUMN price_source VARCHAR(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN source_configuration_id BIGINT NULL;

UPDATE finished_product_prices price
INNER JOIN finished_markup_configurations configuration ON configuration.store_level_id = price.store_level_id
SET price.price_source = 'auto', price.source_configuration_id = configuration.id
WHERE configuration.status = 'enabled'
  AND price.price_coefficient = configuration.price_coefficient
  AND price.price = ROUND(price.cost_price * configuration.price_coefficient, 2);

ALTER TABLE finished_product_prices
  ADD KEY idx_finished_prices_source_configuration (source_configuration_id, price_source),
  ADD CONSTRAINT fk_finished_prices_source_configuration FOREIGN KEY (source_configuration_id)
    REFERENCES finished_markup_configurations(id),
  ADD CONSTRAINT chk_finished_prices_source CHECK (
    (price_source = 'auto' AND source_configuration_id IS NOT NULL)
    OR (price_source = 'manual' AND source_configuration_id IS NULL)
  );
