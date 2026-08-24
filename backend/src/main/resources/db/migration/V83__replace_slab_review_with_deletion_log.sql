CREATE TABLE slab_deletion_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  slab_id BIGINT NOT NULL,
  slab_serial_no VARCHAR(100) NOT NULL,
  slab_name VARCHAR(200) NOT NULL,
  publisher_type VARCHAR(30) NOT NULL,
  deletion_type VARCHAR(30) NOT NULL,
  standard_reason VARCHAR(100),
  detail_reason VARCHAR(1000),
  deleted_by_name VARCHAR(80) NOT NULL,
  deleted_by_account_id BIGINT,
  deleted_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_slab_deletion_logs_deleted_at (deleted_at),
  KEY idx_slab_deletion_logs_slab (slab_id, slab_serial_no),
  KEY idx_slab_deletion_logs_publisher_type (publisher_type),
  KEY idx_slab_deletion_logs_deletion_type (deletion_type)
);

INSERT INTO slab_deletion_logs (
  slab_id, slab_serial_no, slab_name, publisher_type, deletion_type,
  standard_reason, detail_reason, deleted_by_name, deleted_by_account_id, deleted_at, created_at
)
SELECT
  id, serial_no, name, publisher_type, 'PHYSICAL',
  COALESCE(rejection_reason, '历史数据清理'),
  COALESCE(rejection_detail, '按最新接口大板删除规则清理'),
  COALESCE(rejected_by_name, '系统迁移'),
  rejected_by_account_id,
  COALESCE(rejected_at, updated_at, created_at, CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM slab_inventory
WHERE publisher_type = '接口获取'
  AND status IN ('rejected', 'recycle');

INSERT INTO media_cleanup_tasks (media_id, trigger_type, reason, status, created_at, updated_at)
SELECT DISTINCT reference.media_id, 'realtime', '历史接口大板被物理删除', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM media_references reference
INNER JOIN slab_inventory slab
  ON reference.business_domain = 'SLAB' AND reference.business_id = slab.id
WHERE slab.publisher_type = '接口获取'
  AND slab.status IN ('rejected', 'recycle')
  AND NOT EXISTS (
    SELECT 1
    FROM media_cleanup_tasks task
    WHERE task.media_id = reference.media_id
      AND task.status IN ('pending', 'processing', 'failed')
  );

DELETE reference
FROM media_references reference
INNER JOIN slab_inventory slab
  ON reference.business_domain = 'SLAB' AND reference.business_id = slab.id
WHERE slab.publisher_type = '接口获取'
  AND slab.status IN ('rejected', 'recycle');

DELETE FROM slab_inventory
WHERE publisher_type = '接口获取'
  AND status IN ('rejected', 'recycle');

UPDATE slab_inventory
SET status = 'warehouse'
WHERE status = 'pendingReview';

UPDATE slab_inventory
SET created_by_name = '外部系统', created_by_account_id = NULL
WHERE publisher_type = '接口获取';

ALTER TABLE slab_inventory
  DROP FOREIGN KEY fk_slab_inventory_rejected_by_account,
  DROP INDEX idx_slab_inventory_rejected_at,
  DROP INDEX idx_slab_inventory_rejected_by_account_id,
  DROP COLUMN rejection_reason,
  DROP COLUMN rejection_detail,
  DROP COLUMN rejected_by_name,
  DROP COLUMN rejected_by_account_id,
  DROP COLUMN rejected_at;
