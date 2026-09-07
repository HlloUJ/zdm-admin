ALTER TABLE finished_product_attribute_entries
  ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'enabled' AFTER value;

ALTER TABLE finished_product_variants
  ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'enabled' AFTER stock;
