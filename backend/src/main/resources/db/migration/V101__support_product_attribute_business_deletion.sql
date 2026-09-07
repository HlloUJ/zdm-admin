ALTER TABLE product_attributes
  ADD COLUMN deleted_at DATETIME NULL AFTER created_by_account_id,
  ADD COLUMN deleted_by_name VARCHAR(80) NULL AFTER deleted_at,
  ADD COLUMN deleted_by_account_id BIGINT NULL AFTER deleted_by_name,
  ADD KEY idx_product_attributes_active_scope (deleted_at, scope);
