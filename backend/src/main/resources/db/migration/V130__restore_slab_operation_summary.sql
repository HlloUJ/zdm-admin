-- V129 has already run; restore through a new migration and reconstruct historical summaries.
ALTER TABLE slab_operation_logs
  ADD COLUMN operation_summary VARCHAR(255) NOT NULL DEFAULT '' AFTER operation_type;

UPDATE slab_operation_logs
SET operation_summary = CASE
  WHEN operation_type = 'UPDATE' THEN CONCAT('编辑大板（修改', COALESCE(JSON_LENGTH(change_details), 0), '项）')
  WHEN operation_type = 'PRICE_UPDATE' THEN CASE
    WHEN JSON_CONTAINS_PATH(change_details, 'one', '$."价格联动"') THEN '供应链成本变更，按当前系数重算售价'
    ELSE '修改价格' END
  WHEN operation_type = 'SOURCE_SHELF' OR (operation_type = 'SOURCE_SYNC' AND JSON_UNQUOTE(JSON_EXTRACT(change_details, '$."来源状态".after')) = 'selling') THEN CASE
    WHEN before_status IS NULL OR JSON_CONTAINS_PATH(change_details, 'one', '$."入仓价格"') THEN '供应链已上架，大板进入运营仓库并计算价格'
    ELSE '供应链重新上架，解除遮罩并保留运营状态' END
  WHEN operation_type = 'SOURCE_SYNC' THEN CASE JSON_UNQUOTE(JSON_EXTRACT(change_details, '$."来源状态".after'))
    WHEN 'offShelf' THEN '供应链已下架该大板'
    WHEN 'purged' THEN '供应链已删除该大板'
    ELSE '供应链状态变更' END
  WHEN operation_type = 'CREATE' THEN '创建大板'
  WHEN operation_type = 'SHELF' THEN '上架大板'
  WHEN operation_type = 'OFF_SHELF' THEN '下架大板'
  WHEN operation_type = 'RESTORE_WAREHOUSE' THEN '放回仓库'
  WHEN operation_type = 'RESTORE_RECYCLE' THEN '放回仓库'
  WHEN operation_type = 'DELETE_TO_RECYCLE' THEN '删除至回收站'
  WHEN operation_type = 'PHYSICAL_DELETE' THEN '物理删除大板'
  WHEN operation_type = 'PURGE' THEN '彻底删除大板'
  WHEN operation_type = 'SOURCE_OFF_SHELF' THEN '供应链已下架该大板'
  WHEN operation_type = 'SOURCE_DELETE' THEN '供应链已删除该大板'
  WHEN operation_type = 'SOURCE_INTERNAL' THEN '供应链状态变更'
  ELSE '修改大板状态'
END;
