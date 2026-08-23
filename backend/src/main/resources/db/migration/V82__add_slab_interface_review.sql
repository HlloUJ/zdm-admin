ALTER TABLE slab_inventory
  ADD COLUMN rejection_reason VARCHAR(100) NULL AFTER created_by_account_id,
  ADD COLUMN rejection_detail VARCHAR(1000) NULL AFTER rejection_reason,
  ADD COLUMN rejected_by_name VARCHAR(80) NULL AFTER rejection_detail,
  ADD COLUMN rejected_by_account_id BIGINT NULL AFTER rejected_by_name,
  ADD COLUMN rejected_at DATETIME NULL AFTER rejected_by_account_id,
  ADD KEY idx_slab_inventory_rejected_at (rejected_at),
  ADD KEY idx_slab_inventory_rejected_by_account_id (rejected_by_account_id),
  ADD CONSTRAINT fk_slab_inventory_rejected_by_account
    FOREIGN KEY (rejected_by_account_id) REFERENCES accounts (id) ON DELETE SET NULL;

UPDATE slab_inventory
SET status = 'pendingReview'
WHERE publisher_type = '接口获取'
  AND status = 'warehouse';
