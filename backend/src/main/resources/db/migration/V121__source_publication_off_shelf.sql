-- Each platform keeps its own off-shelf explanation and history.
ALTER TABLE finished_products
  ADD COLUMN source_off_shelf_reason VARCHAR(80) NULL,
  ADD COLUMN source_off_shelf_detail VARCHAR(500) NULL,
  ADD COLUMN source_off_shelf_at DATETIME NULL;
ALTER TABLE slab_off_shelf_records
  ADD COLUMN business_client_code VARCHAR(40) NOT NULL DEFAULT 'admin',
  ADD KEY idx_slab_off_shelf_client (slab_id, business_client_code);
