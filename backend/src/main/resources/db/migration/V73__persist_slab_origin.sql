ALTER TABLE slab_inventory
  ADD COLUMN origin_id BIGINT NULL AFTER variety_id,
  ADD KEY idx_slab_inventory_origin_id (origin_id),
  ADD CONSTRAINT fk_slab_inventory_origin
    FOREIGN KEY (origin_id) REFERENCES slab_origins (id);

UPDATE slab_inventory inventory
JOIN slab_varieties variety ON variety.id = inventory.variety_id
SET inventory.origin_id = variety.origin_id
WHERE inventory.origin_id IS NULL
  AND variety.origin_id IS NOT NULL;
