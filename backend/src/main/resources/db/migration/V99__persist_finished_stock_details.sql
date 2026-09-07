ALTER TABLE finished_products
  ADD COLUMN main_image_media_id BIGINT NULL AFTER cover_image,
  ADD COLUMN video_media_id BIGINT NULL AFTER main_image_media_id,
  ADD COLUMN detail LONGTEXT NULL AFTER video_media_id,
  ADD COLUMN off_shelf_reason VARCHAR(500) NULL AFTER guide_price,
  ADD COLUMN created_by_name VARCHAR(100) NULL AFTER status,
  ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name,
  ADD KEY idx_finished_products_supplier_status (supplier_id, status),
  ADD CONSTRAINT fk_finished_products_main_image_media
    FOREIGN KEY (main_image_media_id) REFERENCES media_assets (id),
  ADD CONSTRAINT fk_finished_products_video_media
    FOREIGN KEY (video_media_id) REFERENCES media_assets (id);

CREATE TABLE finished_product_attribute_entries (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  finished_product_id BIGINT NOT NULL,
  attribute_id BIGINT NOT NULL,
  attribute_name VARCHAR(120) NOT NULL,
  value VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_finished_product_attribute (finished_product_id, attribute_id),
  KEY idx_finished_product_attribute_product (finished_product_id, id),
  CONSTRAINT fk_finished_product_attribute_product
    FOREIGN KEY (finished_product_id) REFERENCES finished_products (id) ON DELETE CASCADE,
  CONSTRAINT fk_finished_product_attribute_definition
    FOREIGN KEY (attribute_id) REFERENCES product_attributes (id)
);

CREATE TABLE finished_product_variants (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  finished_product_id BIGINT NOT NULL,
  variant_key VARCHAR(100) NOT NULL,
  variant_label VARCHAR(200) NOT NULL,
  display_mode VARCHAR(20) NOT NULL DEFAULT 'single',
  material VARCHAR(120),
  length_value VARCHAR(120),
  color VARCHAR(120),
  size_value VARCHAR(120),
  stock INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_finished_product_variant_key (finished_product_id, variant_key),
  KEY idx_finished_product_variant_product (finished_product_id, id),
  CONSTRAINT fk_finished_product_variant_product
    FOREIGN KEY (finished_product_id) REFERENCES finished_products (id) ON DELETE CASCADE,
  CONSTRAINT chk_finished_product_variant_stock CHECK (stock >= 0)
);

ALTER TABLE inventory_movements
  ADD KEY idx_inventory_movements_type_inventory_created
    (inventory_type, inventory_id, created_at);
