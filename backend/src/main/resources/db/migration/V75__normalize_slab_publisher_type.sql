UPDATE slab_inventory
SET publisher_type = '平台发布'
WHERE publisher_type IS NULL
   OR publisher_type NOT IN ('平台发布', '接口获取');

ALTER TABLE slab_inventory
  MODIFY COLUMN publisher_type VARCHAR(30) NOT NULL DEFAULT '平台发布';
