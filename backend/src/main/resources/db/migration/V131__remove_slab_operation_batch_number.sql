ALTER TABLE slab_operation_logs
  DROP INDEX idx_slab_operation_logs_batch_no,
  DROP COLUMN batch_no;
