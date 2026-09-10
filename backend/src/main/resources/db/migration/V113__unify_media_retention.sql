ALTER TABLE media_assets
  ADD COLUMN unreferenced_since DATETIME NULL,
  ADD COLUMN history_preview_media_id BIGINT NULL,
  ADD COLUMN history_preview_state VARCHAR(20) NULL,
  ADD COLUMN history_preview_error VARCHAR(500) NULL,
  ADD KEY idx_media_unreferenced (unreferenced_since);
ALTER TABLE media_references
  ADD COLUMN reference_kind VARCHAR(20) NOT NULL DEFAULT 'BUSINESS',
  ADD COLUMN retention_reason VARCHAR(255) NULL,
  ADD KEY idx_media_reference_kind (media_id, reference_kind);
CREATE TABLE media_lifecycle_control (
  id INT PRIMARY KEY,
  deletion_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  migration_completed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO media_lifecycle_control (id) VALUES (1);
-- Unknown historical release times start at migration, never backdate destruction.
UPDATE media_assets a SET unreferenced_since = CURRENT_TIMESTAMP
WHERE status <> 'deleted' AND NOT EXISTS (
  SELECT 1 FROM media_references r WHERE r.media_id = a.id
);

CREATE TABLE media_lifecycle_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  media_id BIGINT NULL,
  event_type VARCHAR(40) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  operator_name VARCHAR(100) NOT NULL,
  operated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
