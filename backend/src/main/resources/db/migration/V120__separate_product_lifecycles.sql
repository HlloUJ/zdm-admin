-- Source availability and operations lifecycle are independent logical records.
-- Source tombstones retain display data until both clients have permanently deleted.
ALTER TABLE finished_products
  ADD COLUMN source_status VARCHAR(20) NOT NULL DEFAULT 'warehouse',
  ADD COLUMN operations_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD KEY idx_finished_source_status (source_status, operations_deleted);
ALTER TABLE slab_inventory
  ADD COLUMN source_status VARCHAR(20) NOT NULL DEFAULT 'warehouse',
  ADD COLUMN operations_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD KEY idx_slab_source_status (source_status, operations_deleted);
ALTER TABLE finished_product_variants ADD COLUMN cost_price DECIMAL(12,2) NULL;

ALTER TABLE finished_operation_logs
  ADD COLUMN business_client_code VARCHAR(40) NOT NULL DEFAULT 'admin',
  ADD COLUMN operator_client_code VARCHAR(40) NULL,
  ADD COLUMN operator_identity_id BIGINT NULL,
  ADD KEY idx_finished_log_client (business_client_code, operated_at);
ALTER TABLE slab_operation_logs
  ADD COLUMN business_client_code VARCHAR(40) NOT NULL DEFAULT 'admin',
  ADD COLUMN operator_client_code VARCHAR(40) NULL,
  ADD COLUMN operator_identity_id BIGINT NULL,
  ADD KEY idx_slab_log_client (business_client_code, operated_at);
