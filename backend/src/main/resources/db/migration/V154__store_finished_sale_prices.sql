ALTER TABLE store_finished_products
  ADD COLUMN store_category_id BIGINT NULL,
  ADD KEY idx_store_finished_category (store_id, store_category_id),
  ADD CONSTRAINT fk_store_finished_category FOREIGN KEY (store_category_id) REFERENCES store_categories (id);

CREATE TABLE store_finished_sale_prices (
  listing_id BIGINT NOT NULL,
  sku_id BIGINT NOT NULL,
  sale_price DECIMAL(12,2) NULL,
  price_mode VARCHAR(16) NOT NULL,
  updated_by_account_id BIGINT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (listing_id, sku_id),
  CONSTRAINT fk_store_sale_listing FOREIGN KEY (listing_id) REFERENCES store_finished_products (id) ON DELETE CASCADE,
  CONSTRAINT fk_store_sale_sku FOREIGN KEY (sku_id) REFERENCES finished_product_variants (id),
  CONSTRAINT chk_store_sale_amount CHECK (sale_price IS NULL OR sale_price >= 0),
  CONSTRAINT chk_store_sale_mode CHECK (price_mode IN ('auto','manual'))
);

-- Obsolete store guide overrides and role minima are not product sale prices.
DROP TABLE store_finished_role_price_overrides;
DROP TABLE store_finished_role_price_configurations;
DROP TABLE store_finished_guide_prices;
