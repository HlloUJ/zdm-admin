ALTER TABLE slab_markup_configurations
  DROP CHECK chk_slab_markup_configurations_rate,
  CHANGE COLUMN markup_rate price_coefficient DECIMAL(7, 4) NOT NULL;

UPDATE slab_markup_configurations
SET price_coefficient = 1 + price_coefficient / 100;

ALTER TABLE slab_markup_configurations
  ADD CONSTRAINT chk_slab_markup_configurations_coefficient CHECK (price_coefficient >= 0);

ALTER TABLE slab_prices
  DROP CHECK chk_slab_prices_rate,
  DROP CHECK chk_slab_prices_values,
  CHANGE COLUMN markup_rate price_coefficient DECIMAL(7, 4) NOT NULL;

UPDATE slab_prices
SET price_coefficient = 1 + price_coefficient / 100;

ALTER TABLE slab_prices
  ADD CONSTRAINT chk_slab_prices_coefficient CHECK (price_coefficient >= 0),
  ADD CONSTRAINT chk_slab_prices_values CHECK (cost_price >= 0 AND price >= 0);
