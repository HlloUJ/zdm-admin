ALTER TABLE slab_inventory
  DROP KEY idx_slab_inventory_source_type,
  DROP COLUMN source_type;
