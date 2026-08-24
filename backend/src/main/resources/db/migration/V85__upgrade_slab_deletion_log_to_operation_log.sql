RENAME TABLE slab_deletion_logs TO slab_operation_logs;

ALTER TABLE slab_operation_logs
  CHANGE COLUMN deletion_type operation_type VARCHAR(40) NOT NULL,
  CHANGE COLUMN deleted_by_name operator_name VARCHAR(80) NOT NULL,
  CHANGE COLUMN deleted_by_account_id operator_account_id BIGINT NULL,
  CHANGE COLUMN deleted_at operated_at DATETIME NOT NULL,
  ADD COLUMN operation_summary VARCHAR(255) NOT NULL DEFAULT '' AFTER operation_type,
  ADD COLUMN before_status VARCHAR(20) NULL AFTER operation_summary,
  ADD COLUMN after_status VARCHAR(20) NULL AFTER before_status,
  ADD COLUMN change_details JSON NULL AFTER detail_reason,
  ADD COLUMN operation_source VARCHAR(30) NOT NULL DEFAULT 'MANUAL' AFTER change_details,
  ADD COLUMN batch_no CHAR(36) NULL AFTER operation_source,
  RENAME INDEX idx_slab_deletion_logs_deleted_at TO idx_slab_operation_logs_operated_at,
  RENAME INDEX idx_slab_deletion_logs_slab TO idx_slab_operation_logs_slab,
  RENAME INDEX idx_slab_deletion_logs_publisher_type TO idx_slab_operation_logs_publisher_type,
  RENAME INDEX idx_slab_deletion_logs_deletion_type TO idx_slab_operation_logs_operation_type,
  ADD KEY idx_slab_operation_logs_operator (operator_account_id, operated_at),
  ADD KEY idx_slab_operation_logs_batch_no (batch_no);

UPDATE slab_operation_logs
SET operation_type = CASE operation_type
      WHEN 'RECYCLE' THEN 'DELETE_TO_RECYCLE'
      WHEN 'PHYSICAL' THEN 'PHYSICAL_DELETE'
      WHEN 'PURGE' THEN 'PURGE'
      ELSE operation_type
    END,
    operation_summary = CASE operation_type
      WHEN 'RECYCLE' THEN '删除至回收站'
      WHEN 'PHYSICAL' THEN '物理删除外部大板'
      WHEN 'PURGE' THEN '彻底删除大板'
      ELSE '历史操作'
    END,
    before_status = CASE operation_type WHEN 'PURGE' THEN 'recycle' ELSE NULL END,
    after_status = CASE operation_type WHEN 'RECYCLE' THEN 'recycle' ELSE NULL END;

UPDATE roles
SET function_permissions = REPLACE(
  function_permissions,
  'admin.slab-management.delete-log.view',
  'admin.slab-management.operation-log.view')
WHERE FIND_IN_SET('admin.slab-management.delete-log.view', function_permissions) > 0;

UPDATE terminal_function_policies
SET function_permissions = REPLACE(
  function_permissions,
  'admin.slab-management.delete-log.view',
  'admin.slab-management.operation-log.view')
WHERE FIND_IN_SET('admin.slab-management.delete-log.view', function_permissions) > 0;
