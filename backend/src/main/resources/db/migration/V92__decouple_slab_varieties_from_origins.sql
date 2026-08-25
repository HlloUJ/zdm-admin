UPDATE slab_inventory inventory
JOIN slab_varieties variety ON variety.id = inventory.variety_id
SET inventory.origin_id = variety.origin_id
WHERE inventory.origin_id IS NULL
  AND variety.origin_id IS NOT NULL;

ALTER TABLE slab_varieties
  DROP FOREIGN KEY fk_slab_varieties_origin,
  DROP COLUMN origin_id;
