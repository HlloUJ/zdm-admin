ALTER TABLE finished_products
  ADD COLUMN selection_generation BIGINT NOT NULL DEFAULT 0;

ALTER TABLE store_finished_products
  ADD COLUMN selection_generation BIGINT NOT NULL DEFAULT 0,
  DROP INDEX uk_store_finished_product,
  ADD UNIQUE KEY uk_store_finished_product_generation
    (store_id, finished_product_id, selection_generation);
