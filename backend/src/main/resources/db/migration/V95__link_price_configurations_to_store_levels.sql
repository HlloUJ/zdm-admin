ALTER TABLE store_levels
  ADD COLUMN sort_order INT NULL AFTER name;

UPDATE store_levels
SET sort_order = id
WHERE sort_order IS NULL;

ALTER TABLE store_levels
  MODIFY COLUMN sort_order INT NOT NULL,
  ADD CONSTRAINT chk_store_levels_sort_order CHECK (sort_order > 0);

ALTER TABLE finished_markup_configurations
  ADD COLUMN store_level_id BIGINT NULL AFTER id,
  MODIFY COLUMN name VARCHAR(120) NOT NULL;

ALTER TABLE slab_markup_configurations
  ADD COLUMN store_level_id BIGINT NULL AFTER id,
  MODIFY COLUMN name VARCHAR(120) NOT NULL;

INSERT INTO store_levels
  (name, sort_order, status, created_by_name, created_by_account_id, remark)
SELECT DISTINCT
  SUBSTRING_INDEX(configuration.name, '级合伙人价格', 1),
  (SELECT COALESCE(MAX(existing.sort_order), 0) FROM store_levels existing)
    + ROW_NUMBER() OVER (ORDER BY configuration.name),
  'enabled',
  '系统迁移',
  1,
  '由历史价格配置迁移'
FROM (
  SELECT name FROM finished_markup_configurations
  UNION
  SELECT name FROM slab_markup_configurations
) configuration
LEFT JOIN store_levels level
  ON level.name = SUBSTRING_INDEX(configuration.name, '级合伙人价格', 1)
WHERE configuration.name REGEXP '^[0-9]+级合伙人价格$'
  AND level.id IS NULL;

UPDATE finished_markup_configurations configuration
INNER JOIN store_levels level
  ON configuration.name = level.name
  OR (
    configuration.name REGEXP '^[0-9]+级合伙人价格$'
    AND level.name = SUBSTRING_INDEX(configuration.name, '级合伙人价格', 1)
  )
SET configuration.store_level_id = level.id;

UPDATE slab_markup_configurations configuration
INNER JOIN store_levels level
  ON configuration.name = level.name
  OR (
    configuration.name REGEXP '^[0-9]+级合伙人价格$'
    AND level.name = SUBSTRING_INDEX(configuration.name, '级合伙人价格', 1)
  )
SET configuration.store_level_id = level.id;

UPDATE finished_markup_configurations SET status = 'enabled';
UPDATE slab_markup_configurations SET status = 'enabled';

ALTER TABLE finished_markup_configurations
  MODIFY COLUMN store_level_id BIGINT NOT NULL,
  ADD UNIQUE KEY uk_finished_markup_configurations_store_level (store_level_id),
  ADD CONSTRAINT fk_finished_markup_configurations_store_level
    FOREIGN KEY (store_level_id) REFERENCES store_levels(id);

ALTER TABLE slab_markup_configurations
  MODIFY COLUMN store_level_id BIGINT NOT NULL,
  ADD UNIQUE KEY uk_slab_markup_configurations_store_level (store_level_id),
  ADD CONSTRAINT fk_slab_markup_configurations_store_level
    FOREIGN KEY (store_level_id) REFERENCES store_levels(id);
