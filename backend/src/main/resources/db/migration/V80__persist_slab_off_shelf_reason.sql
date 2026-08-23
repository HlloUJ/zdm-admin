ALTER TABLE slab_inventory
  ADD COLUMN off_shelf_reason VARCHAR(80) NULL AFTER status,
  ADD COLUMN off_shelf_detail VARCHAR(500) NULL AFTER off_shelf_reason;
