CREATE TABLE store_levels (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_by_name VARCHAR(80) NOT NULL DEFAULT '韩健',
  remark VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_store_levels_code (code),
  UNIQUE KEY uk_store_levels_name (name)
);

INSERT INTO store_levels (code, name, status, remark)
VALUES
  ('level1', '1级', 'enabled', '历史店铺级别迁移'),
  ('level2', '2级', 'enabled', '历史店铺级别迁移'),
  ('level3', '3级', 'enabled', '历史店铺级别迁移');

ALTER TABLE stores ADD COLUMN store_level_id BIGINT NULL AFTER shop_level;

UPDATE stores s
JOIN store_levels sl ON sl.code = s.shop_level
SET s.store_level_id = sl.id
WHERE s.store_level_id IS NULL;

ALTER TABLE stores
  ADD CONSTRAINT fk_stores_store_level
  FOREIGN KEY (store_level_id) REFERENCES store_levels(id);
