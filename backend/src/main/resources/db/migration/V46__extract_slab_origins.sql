CREATE TABLE slab_origins (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_by_name VARCHAR(80) NOT NULL DEFAULT '韩健',
  remark VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_slab_origins_name (name)
);

INSERT INTO slab_origins (name, status, created_by_name)
SELECT DISTINCT TRIM(origin), 'enabled', '韩健'
FROM slab_varieties
WHERE origin IS NOT NULL
  AND TRIM(origin) <> '';

ALTER TABLE slab_varieties
ADD COLUMN origin_id BIGINT AFTER code;

UPDATE slab_varieties sv
JOIN slab_origins so ON so.name = TRIM(sv.origin)
SET sv.origin_id = so.id
WHERE sv.origin IS NOT NULL
  AND TRIM(sv.origin) <> '';

ALTER TABLE slab_varieties
ADD CONSTRAINT fk_slab_varieties_origin
FOREIGN KEY (origin_id) REFERENCES slab_origins (id);

ALTER TABLE slab_varieties
DROP COLUMN origin;
