CREATE TABLE slab_off_shelf_records (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  slab_id BIGINT NOT NULL,
  standard_reason VARCHAR(80) NOT NULL,
  detail_reason VARCHAR(500),
  off_shelved_at DATETIME NOT NULL,
  off_shelved_by_name VARCHAR(80) NOT NULL,
  off_shelved_by_account_id BIGINT,
  KEY idx_slab_off_shelf_records_slab_time (slab_id, off_shelved_at DESC, id DESC),
  CONSTRAINT fk_slab_off_shelf_records_slab
    FOREIGN KEY (slab_id) REFERENCES slab_inventory (id) ON DELETE CASCADE
);

INSERT INTO slab_off_shelf_records (
  slab_id,
  standard_reason,
  detail_reason,
  off_shelved_at,
  off_shelved_by_name,
  off_shelved_by_account_id
)
SELECT
  id,
  off_shelf_reason,
  off_shelf_detail,
  updated_at,
  '历史数据',
  NULL
FROM slab_inventory
WHERE off_shelf_reason IS NOT NULL AND off_shelf_reason <> '';

ALTER TABLE slab_inventory
  DROP COLUMN off_shelf_detail,
  DROP COLUMN off_shelf_reason;
