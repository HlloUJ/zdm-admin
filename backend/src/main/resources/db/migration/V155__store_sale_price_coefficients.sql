ALTER TABLE store_finished_sale_prices
  ADD COLUMN sale_coefficient DECIMAL(12,2) NULL,
  ADD CONSTRAINT chk_store_sale_coefficient CHECK (sale_coefficient IS NULL OR sale_coefficient >= 0);
