-- Preserve the previous UI baseline; historical user input was never persisted.
ALTER TABLE slab_inventory ADD COLUMN stock INT NOT NULL DEFAULT 1;
UPDATE slab_inventory SET stock = 0 WHERE status = 'soldOut';
