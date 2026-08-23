ALTER TABLE slab_inventory
  ADD COLUMN scan_image_url VARCHAR(500) NULL AFTER main_image_url,
  ADD COLUMN design_image_url VARCHAR(500) NULL AFTER scan_image_url,
  ADD COLUMN video_url VARCHAR(500) NULL AFTER design_image_url,
  ADD COLUMN video_cover_url VARCHAR(500) NULL AFTER video_url;
