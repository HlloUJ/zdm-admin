ALTER TABLE slab_inventory
  ADD COLUMN source_type VARCHAR(20) NOT NULL DEFAULT 'PLATFORM' AFTER publisher_type,
  ADD COLUMN created_by_name VARCHAR(80) NOT NULL DEFAULT '平台运营人员' AFTER source_type,
  ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name,
  ADD KEY idx_slab_inventory_created_at (created_at),
  ADD KEY idx_slab_inventory_source_type (source_type),
  ADD KEY idx_slab_inventory_created_by_account_id (created_by_account_id);
