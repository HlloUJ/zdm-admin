UPDATE slab_inventory
SET created_by_name = '接口获取'
WHERE publisher_type = '接口获取'
  AND (created_by_name IS NULL OR created_by_name = '外部系统');
