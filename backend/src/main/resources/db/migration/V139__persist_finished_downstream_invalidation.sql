-- Invalidation belongs to the downstream operating record, not current source availability.
ALTER TABLE finished_products
  ADD COLUMN operations_invalidated_reason VARCHAR(200) NULL,
  ADD COLUMN operations_invalidated_at DATETIME NULL;
ALTER TABLE store_finished_products
  ADD COLUMN invalidated_reason VARCHAR(200) NULL,
  ADD COLUMN invalidated_at DATETIME NULL;

UPDATE finished_products SET operations_invalidated_reason = CASE source_status
  WHEN 'offShelf' THEN '该商品曾被供应链下架，请彻底删除后重新获取'
  WHEN 'recycle' THEN '该商品曾被供应链删除至回收站，请彻底删除后重新获取'
  ELSE '该商品曾被供应链彻底删除，请彻底删除后重新获取' END,
  operations_invalidated_at = COALESCE(source_off_shelf_at, updated_at, created_at)
WHERE operations_deleted = FALSE AND source_status IN ('offShelf','recycle','purged');

-- Keep all old rows visible. Never delete or merge conflicting historical selections here.
UPDATE store_finished_products l JOIN finished_products p ON p.id=l.finished_product_id
SET l.invalidated_reason = CASE
  WHEN l.selection_generation <> p.selection_generation THEN '来源商品曾重新发布，旧记录已失效，请彻底删除后重新选择'
  WHEN p.operations_invalidated_reason IS NOT NULL THEN p.operations_invalidated_reason
  WHEN p.operations_deleted = TRUE THEN '该商品曾被运营管理平台彻底删除，请彻底删除后重新选择'
  WHEN p.status = 'recycle' THEN '该商品曾被运营管理平台删除至回收站，请彻底删除后重新选择'
  ELSE '该商品曾被运营管理平台下架，请彻底删除后重新选择' END,
  l.invalidated_at = COALESCE(p.operations_invalidated_at,p.updated_at,p.created_at)
WHERE l.selection_generation <> p.selection_generation OR p.operations_invalidated_reason IS NOT NULL
  OR p.operations_deleted = TRUE OR p.status IN ('offShelf','recycle');
