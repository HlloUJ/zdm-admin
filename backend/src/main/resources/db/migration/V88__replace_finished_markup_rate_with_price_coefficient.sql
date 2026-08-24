ALTER TABLE finished_markup_configurations
  DROP CHECK chk_finished_markup_configurations_rate,
  CHANGE COLUMN markup_rate price_coefficient DECIMAL(7, 4) NOT NULL;

UPDATE finished_markup_configurations
SET price_coefficient = 1 + price_coefficient / 100;

ALTER TABLE finished_markup_configurations
  ADD CONSTRAINT chk_finished_markup_configurations_coefficient CHECK (price_coefficient >= 0);

ALTER TABLE finished_product_prices
  DROP CHECK chk_finished_product_prices_rate,
  DROP CHECK chk_finished_product_prices_values,
  CHANGE COLUMN markup_rate price_coefficient DECIMAL(7, 4) NOT NULL;

UPDATE finished_product_prices
SET price_coefficient = 1 + price_coefficient / 100;

ALTER TABLE finished_product_prices
  ADD CONSTRAINT chk_finished_product_prices_coefficient CHECK (price_coefficient >= 0),
  ADD CONSTRAINT chk_finished_product_prices_values CHECK (cost_price >= 0 AND price >= 0);
