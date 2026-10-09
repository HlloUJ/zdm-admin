-- Keep downstream invalidation independent of the current source status.
ALTER TABLE slab_inventory
  ADD COLUMN operations_invalidated_reason VARCHAR(200) NULL,
  ADD COLUMN operations_invalidated_at DATETIME NULL,
  ADD COLUMN operations_invalidated_snapshot JSON NULL;

-- Historical snapshots cannot be reconstructed from current source data.
UPDATE slab_inventory SET operations_invalidated_reason = CASE source_status
  WHEN 'offShelf' THEN '该商品已被供应链下架'
  WHEN 'recycle' THEN '该商品已被供应链删除至回收站'
  ELSE '该商品已被供应链彻底删除' END,
  operations_invalidated_at = COALESCE(updated_at, created_at)
WHERE operations_deleted = FALSE AND source_status IN ('offShelf','recycle','purged');
