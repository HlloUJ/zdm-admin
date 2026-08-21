ALTER TABLE store_levels ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;
ALTER TABLE product_categories ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;
ALTER TABLE product_attributes ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;
ALTER TABLE product_attribute_values ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;
ALTER TABLE category_attributes ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;
ALTER TABLE crafts ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;
ALTER TABLE slab_varieties ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;
ALTER TABLE slab_origins ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;
ALTER TABLE slab_textures ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;
ALTER TABLE slab_colors ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;
ALTER TABLE slab_color_categories ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;
ALTER TABLE slab_grades ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;
ALTER TABLE suppliers ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;
ALTER TABLE employees ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;
ALTER TABLE roles ADD COLUMN created_by_account_id BIGINT NULL AFTER created_by_name;

CREATE TEMPORARY TABLE creator_account_matches AS
SELECT display_name, MIN(id) AS account_id
FROM accounts
GROUP BY display_name
HAVING COUNT(*) = 1;

UPDATE store_levels target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;
UPDATE product_categories target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;
UPDATE product_attributes target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;
UPDATE product_attribute_values target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;
UPDATE category_attributes target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;
UPDATE crafts target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;
UPDATE slab_varieties target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;
UPDATE slab_origins target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;
UPDATE slab_textures target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;
UPDATE slab_colors target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;
UPDATE slab_color_categories target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;
UPDATE slab_grades target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;
UPDATE suppliers target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;
UPDATE employees target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;
UPDATE roles target JOIN creator_account_matches matched ON matched.display_name = target.created_by_name SET target.created_by_account_id = matched.account_id;

UPDATE store_levels SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';
UPDATE product_categories SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';
UPDATE product_attributes SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';
UPDATE product_attribute_values SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';
UPDATE category_attributes SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';
UPDATE crafts SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';
UPDATE slab_varieties SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';
UPDATE slab_origins SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';
UPDATE slab_textures SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';
UPDATE slab_colors SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';
UPDATE slab_color_categories SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';
UPDATE slab_grades SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';
UPDATE suppliers SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';
UPDATE employees SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';
UPDATE roles SET created_by_account_id = 1 WHERE created_by_account_id IS NULL AND created_by_name = '韩健';

DROP TEMPORARY TABLE creator_account_matches;

ALTER TABLE store_levels ADD KEY idx_store_levels_created_by_account_id (created_by_account_id);
ALTER TABLE product_categories ADD KEY idx_product_categories_created_by_account_id (created_by_account_id);
ALTER TABLE product_attributes ADD KEY idx_product_attributes_created_by_account_id (created_by_account_id);
ALTER TABLE product_attribute_values ADD KEY idx_product_attribute_values_created_by_account_id (created_by_account_id);
ALTER TABLE category_attributes ADD KEY idx_category_attributes_created_by_account_id (created_by_account_id);
ALTER TABLE crafts ADD KEY idx_crafts_created_by_account_id (created_by_account_id);
ALTER TABLE slab_varieties ADD KEY idx_slab_varieties_created_by_account_id (created_by_account_id);
ALTER TABLE slab_origins ADD KEY idx_slab_origins_created_by_account_id (created_by_account_id);
ALTER TABLE slab_textures ADD KEY idx_slab_textures_created_by_account_id (created_by_account_id);
ALTER TABLE slab_colors ADD KEY idx_slab_colors_created_by_account_id (created_by_account_id);
ALTER TABLE slab_color_categories ADD KEY idx_slab_color_categories_created_by_account_id (created_by_account_id);
ALTER TABLE slab_grades ADD KEY idx_slab_grades_created_by_account_id (created_by_account_id);
ALTER TABLE suppliers ADD KEY idx_suppliers_created_by_account_id (created_by_account_id);
ALTER TABLE employees ADD KEY idx_employees_created_by_account_id (created_by_account_id);
ALTER TABLE roles ADD KEY idx_roles_created_by_account_id (created_by_account_id);
