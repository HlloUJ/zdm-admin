INSERT INTO markup_configurations
  (product_type, name, markup_rate, status, created_by_name, created_by_account_id)
SELECT 'finished', '指导价', 20.0000, 'enabled', '韩健', 1
WHERE NOT EXISTS (
  SELECT 1 FROM markup_configurations WHERE product_type = 'finished' AND name = '指导价'
);

INSERT INTO markup_configurations
  (product_type, name, markup_rate, status, created_by_name, created_by_account_id)
SELECT 'finished', '1级合伙人价格', 10.0000, 'enabled', '韩健', 1
WHERE NOT EXISTS (
  SELECT 1 FROM markup_configurations WHERE product_type = 'finished' AND name = '1级合伙人价格'
);

INSERT INTO markup_configurations
  (product_type, name, markup_rate, status, created_by_name, created_by_account_id)
SELECT 'finished', '2级合伙人价格', 5.0000, 'enabled', '韩健', 1
WHERE NOT EXISTS (
  SELECT 1 FROM markup_configurations WHERE product_type = 'finished' AND name = '2级合伙人价格'
);

INSERT INTO markup_configurations
  (product_type, name, markup_rate, status, created_by_name, created_by_account_id)
SELECT 'finished', '3级合伙人价格', 0.0000, 'enabled', '韩健', 1
WHERE NOT EXISTS (
  SELECT 1 FROM markup_configurations WHERE product_type = 'finished' AND name = '3级合伙人价格'
);

INSERT INTO markup_configurations
  (product_type, name, markup_rate, status, created_by_name, created_by_account_id)
SELECT 'slab', '指导价', 60.0000, 'enabled', '韩健', 1
WHERE NOT EXISTS (
  SELECT 1 FROM markup_configurations WHERE product_type = 'slab' AND name = '指导价'
);

INSERT INTO markup_configurations
  (product_type, name, markup_rate, status, created_by_name, created_by_account_id)
SELECT 'slab', '1级合伙人价格', 45.0000, 'enabled', '韩健', 1
WHERE NOT EXISTS (
  SELECT 1 FROM markup_configurations WHERE product_type = 'slab' AND name = '1级合伙人价格'
);

INSERT INTO markup_configurations
  (product_type, name, markup_rate, status, created_by_name, created_by_account_id)
SELECT 'slab', '2级合伙人价格', 30.0000, 'enabled', '韩健', 1
WHERE NOT EXISTS (
  SELECT 1 FROM markup_configurations WHERE product_type = 'slab' AND name = '2级合伙人价格'
);

INSERT INTO markup_configurations
  (product_type, name, markup_rate, status, created_by_name, created_by_account_id)
SELECT 'slab', '3级合伙人价格', 18.0000, 'enabled', '韩健', 1
WHERE NOT EXISTS (
  SELECT 1 FROM markup_configurations WHERE product_type = 'slab' AND name = '3级合伙人价格'
);
