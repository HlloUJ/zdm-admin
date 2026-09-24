ALTER TABLE finished_products ADD COLUMN source_block_reason VARCHAR(32) NULL;
ALTER TABLE slab_inventory ADD COLUMN source_block_reason VARCHAR(32) NULL;

UPDATE finished_products SET source_block_reason = CASE source_status
  WHEN 'offShelf' THEN 'OFF_SHELF'
  WHEN 'recycle' THEN 'DELETE_TO_RECYCLE'
  WHEN 'purged' THEN 'PURGE'
  ELSE NULL END;

UPDATE slab_inventory SET source_block_reason = CASE source_status
  WHEN 'offShelf' THEN 'OFF_SHELF'
  WHEN 'recycle' THEN 'DELETE_TO_RECYCLE'
  WHEN 'purged' THEN 'PURGE'
  ELSE NULL END;
