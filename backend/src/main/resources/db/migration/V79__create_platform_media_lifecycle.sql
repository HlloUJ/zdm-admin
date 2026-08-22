CREATE TABLE media_assets (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  original_name VARCHAR(255),
  media_type VARCHAR(20) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  access_level VARCHAR(20) NOT NULL DEFAULT 'public',
  owner_client_code VARCHAR(40) NOT NULL,
  tenant_id BIGINT,
  store_id BIGINT,
  created_by_account_id BIGINT,
  derived_from_media_id BIGINT,
  status VARCHAR(20) NOT NULL DEFAULT 'temporary',
  confirmed_at DATETIME,
  last_referenced_at DATETIME,
  pending_delete_at DATETIME,
  deleted_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_media_assets_public_id (public_id),
  UNIQUE KEY uk_media_assets_storage_key (storage_key),
  KEY idx_media_assets_status_created (status, created_at),
  KEY idx_media_assets_owner (owner_client_code, tenant_id, store_id),
  CONSTRAINT fk_media_assets_derived_from FOREIGN KEY (derived_from_media_id) REFERENCES media_assets (id)
);

CREATE TABLE media_references (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  media_id BIGINT NOT NULL,
  business_domain VARCHAR(80) NOT NULL,
  business_id BIGINT NOT NULL,
  field_key VARCHAR(80) NOT NULL,
  owner_client_code VARCHAR(40) NOT NULL,
  tenant_id BIGINT,
  store_id BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_media_references_business_field (business_domain, business_id, field_key),
  KEY idx_media_references_media_id (media_id),
  KEY idx_media_references_owner (owner_client_code, tenant_id, store_id),
  CONSTRAINT fk_media_references_media FOREIGN KEY (media_id) REFERENCES media_assets (id)
);

CREATE TABLE media_cleanup_tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  media_id BIGINT NOT NULL,
  trigger_type VARCHAR(30) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  last_error VARCHAR(500),
  next_retry_at DATETIME,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_media_cleanup_tasks_pending (status, next_retry_at),
  KEY idx_media_cleanup_tasks_media_id (media_id),
  CONSTRAINT fk_media_cleanup_tasks_media FOREIGN KEY (media_id) REFERENCES media_assets (id)
);

CREATE TABLE media_cleanup_runs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  trigger_type VARCHAR(30) NOT NULL,
  scanned_count INT NOT NULL DEFAULT 0,
  deleted_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  released_bytes BIGINT NOT NULL DEFAULT 0,
  started_at DATETIME NOT NULL,
  finished_at DATETIME,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

ALTER TABLE crafts ADD COLUMN image_media_id BIGINT NULL AFTER image_url;
ALTER TABLE slab_inventory
  ADD COLUMN main_image_media_id BIGINT NULL AFTER main_image_url,
  ADD COLUMN scan_image_media_id BIGINT NULL AFTER scan_image_url,
  ADD COLUMN design_image_media_id BIGINT NULL AFTER design_image_url,
  ADD COLUMN video_media_id BIGINT NULL AFTER video_url,
  ADD COLUMN video_cover_media_id BIGINT NULL AFTER video_cover_url;

INSERT INTO media_assets (
  public_id, storage_key, original_name, media_type, mime_type, access_level,
  owner_client_code, created_by_account_id, status, confirmed_at, last_referenced_at, created_at, updated_at
)
SELECT
  SUBSTRING_INDEX(SUBSTRING_INDEX(image_url, '/', -1), '.', 1),
  SUBSTRING_INDEX(image_url, '/', -1),
  SUBSTRING_INDEX(image_url, '/', -1),
  'image',
  CASE LOWER(SUBSTRING_INDEX(image_url, '.', -1))
    WHEN 'jpg' THEN 'image/jpeg' WHEN 'png' THEN 'image/png'
    WHEN 'gif' THEN 'image/gif' WHEN 'webp' THEN 'image/webp'
    ELSE 'application/octet-stream' END,
  'public', 'ADMIN', created_by_account_id, 'active', created_at, created_at, created_at, updated_at
FROM crafts
WHERE image_url REGEXP '^/api/open/craft-images/[0-9a-f-]{36}\\.(jpg|png|gif|webp)$'
ON DUPLICATE KEY UPDATE storage_key = VALUES(storage_key);

UPDATE crafts craft
JOIN media_assets asset ON asset.storage_key = SUBSTRING_INDEX(craft.image_url, '/', -1)
SET craft.image_media_id = asset.id
WHERE craft.image_url LIKE '/api/open/craft-images/%';

INSERT INTO media_assets (
  public_id, storage_key, original_name, media_type, mime_type, access_level,
  owner_client_code, created_by_account_id, status, confirmed_at, last_referenced_at, created_at, updated_at
)
SELECT DISTINCT
  SUBSTRING_INDEX(SUBSTRING_INDEX(source.url, '/', -1), '.', 1),
  CONCAT('slabs/', SUBSTRING_INDEX(source.url, '/', -1)),
  SUBSTRING_INDEX(source.url, '/', -1),
  CASE WHEN LOWER(SUBSTRING_INDEX(source.url, '.', -1)) IN ('mp4', 'webm', 'mov') THEN 'video' ELSE 'image' END,
  CASE LOWER(SUBSTRING_INDEX(source.url, '.', -1))
    WHEN 'jpg' THEN 'image/jpeg' WHEN 'png' THEN 'image/png'
    WHEN 'gif' THEN 'image/gif' WHEN 'webp' THEN 'image/webp'
    WHEN 'mp4' THEN 'video/mp4' WHEN 'webm' THEN 'video/webm'
    WHEN 'mov' THEN 'video/quicktime' ELSE 'application/octet-stream' END,
  'public', 'ADMIN', source.created_by_account_id, 'active', source.created_at, source.created_at,
  source.created_at, source.updated_at
FROM (
  SELECT main_image_url AS url, created_by_account_id, created_at, updated_at FROM slab_inventory
  UNION ALL SELECT scan_image_url, created_by_account_id, created_at, updated_at FROM slab_inventory
  UNION ALL SELECT design_image_url, created_by_account_id, created_at, updated_at FROM slab_inventory
  UNION ALL SELECT video_url, created_by_account_id, created_at, updated_at FROM slab_inventory
  UNION ALL SELECT video_cover_url, created_by_account_id, created_at, updated_at FROM slab_inventory
) source
WHERE source.url REGEXP '^/api/open/slab-images/[0-9a-f-]{36}\\.(jpg|png|gif|webp|mp4|webm|mov)$'
ON DUPLICATE KEY UPDATE storage_key = VALUES(storage_key);

UPDATE slab_inventory slab
LEFT JOIN media_assets main_asset ON main_asset.storage_key = CONCAT('slabs/', SUBSTRING_INDEX(slab.main_image_url, '/', -1))
LEFT JOIN media_assets scan_asset ON scan_asset.storage_key = CONCAT('slabs/', SUBSTRING_INDEX(slab.scan_image_url, '/', -1))
LEFT JOIN media_assets design_asset ON design_asset.storage_key = CONCAT('slabs/', SUBSTRING_INDEX(slab.design_image_url, '/', -1))
LEFT JOIN media_assets video_asset ON video_asset.storage_key = CONCAT('slabs/', SUBSTRING_INDEX(slab.video_url, '/', -1))
LEFT JOIN media_assets cover_asset ON cover_asset.storage_key = CONCAT('slabs/', SUBSTRING_INDEX(slab.video_cover_url, '/', -1))
SET slab.main_image_media_id = main_asset.id,
    slab.scan_image_media_id = scan_asset.id,
    slab.design_image_media_id = design_asset.id,
    slab.video_media_id = video_asset.id,
    slab.video_cover_media_id = cover_asset.id;

UPDATE media_assets cover_asset
JOIN slab_inventory slab ON slab.video_cover_media_id = cover_asset.id
SET cover_asset.derived_from_media_id = slab.video_media_id
WHERE slab.video_media_id IS NOT NULL;

INSERT INTO media_references (
  media_id, business_domain, business_id, field_key, owner_client_code, tenant_id, store_id, created_at, updated_at
)
SELECT image_media_id, 'FINISHED_STOCK_CRAFT', id, 'image', 'ADMIN', NULL, NULL, created_at, updated_at
FROM crafts WHERE image_media_id IS NOT NULL;

INSERT INTO media_references (
  media_id, business_domain, business_id, field_key, owner_client_code, tenant_id, store_id, created_at, updated_at
)
SELECT media_id, 'SLAB', business_id, field_key, 'ADMIN', NULL, NULL, created_at, updated_at
FROM (
  SELECT main_image_media_id AS media_id, id AS business_id, 'mainImage' AS field_key, created_at, updated_at FROM slab_inventory
  UNION ALL SELECT scan_image_media_id, id, 'scanImage', created_at, updated_at FROM slab_inventory
  UNION ALL SELECT design_image_media_id, id, 'designImage', created_at, updated_at FROM slab_inventory
  UNION ALL SELECT video_media_id, id, 'video', created_at, updated_at FROM slab_inventory
  UNION ALL SELECT video_cover_media_id, id, 'videoCover', created_at, updated_at FROM slab_inventory
) refs
WHERE media_id IS NOT NULL;

ALTER TABLE crafts
  ADD CONSTRAINT fk_crafts_image_media FOREIGN KEY (image_media_id) REFERENCES media_assets (id);

ALTER TABLE slab_inventory
  ADD CONSTRAINT fk_slab_main_image_media FOREIGN KEY (main_image_media_id) REFERENCES media_assets (id),
  ADD CONSTRAINT fk_slab_scan_image_media FOREIGN KEY (scan_image_media_id) REFERENCES media_assets (id),
  ADD CONSTRAINT fk_slab_design_image_media FOREIGN KEY (design_image_media_id) REFERENCES media_assets (id),
  ADD CONSTRAINT fk_slab_video_media FOREIGN KEY (video_media_id) REFERENCES media_assets (id),
  ADD CONSTRAINT fk_slab_video_cover_media FOREIGN KEY (video_cover_media_id) REFERENCES media_assets (id);
