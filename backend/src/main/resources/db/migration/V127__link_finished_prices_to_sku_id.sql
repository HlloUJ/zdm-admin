-- Preserve resolvable existing prices. Unmatched rows fail the NOT NULL conversion
-- rather than being silently deleted; investigate them before retrying migration.
ALTER TABLE finished_product_guide_prices ADD COLUMN sku_id BIGINT NULL;
ALTER TABLE finished_product_prices ADD COLUMN sku_id BIGINT NULL;
UPDATE finished_product_guide_prices p
JOIN finished_product_variants v ON v.finished_product_id=p.finished_product_id AND v.variant_key=p.variant_key
SET p.sku_id=v.id;
UPDATE finished_product_prices p
JOIN finished_product_variants v ON v.finished_product_id=p.finished_product_id AND v.variant_key=p.variant_key
SET p.sku_id=v.id;
ALTER TABLE finished_product_variants
  ADD UNIQUE KEY uk_finished_variant_product_id (finished_product_id,id);
ALTER TABLE finished_product_guide_prices
  DROP INDEX uk_finished_product_guide_prices_variant,
  MODIFY COLUMN sku_id BIGINT NOT NULL,
  ADD UNIQUE KEY uk_finished_guide_sku (finished_product_id,sku_id),
  ADD CONSTRAINT fk_finished_guide_sku FOREIGN KEY (finished_product_id,sku_id)
    REFERENCES finished_product_variants(finished_product_id,id) ON DELETE CASCADE,
  DROP COLUMN variant_key;
ALTER TABLE finished_product_prices
  DROP INDEX uk_finished_product_prices_store_level,
  DROP INDEX idx_finished_product_prices_product,
  MODIFY COLUMN sku_id BIGINT NOT NULL,
  ADD UNIQUE KEY uk_finished_price_sku_level (finished_product_id,sku_id,store_level_id),
  ADD CONSTRAINT fk_finished_price_sku FOREIGN KEY (finished_product_id,sku_id)
    REFERENCES finished_product_variants(finished_product_id,id) ON DELETE CASCADE,
  DROP COLUMN variant_key;
ALTER TABLE finished_product_variants
  DROP INDEX uk_finished_product_variant_key,
  DROP COLUMN variant_key;
