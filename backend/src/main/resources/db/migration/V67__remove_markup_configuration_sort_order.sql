ALTER TABLE markup_configurations
  DROP INDEX idx_markup_configurations_type_status_sort,
  DROP CHECK chk_markup_configurations_sort,
  DROP COLUMN sort_order,
  ADD KEY idx_markup_configurations_type_status_created
    (product_type, status, created_at, id);

ALTER TABLE product_markup_price_snapshots
  DROP INDEX idx_product_markup_snapshot_product,
  DROP COLUMN sort_order_snapshot,
  ADD KEY idx_product_markup_snapshot_product
    (product_type, product_id, is_current, variant_key, id);
