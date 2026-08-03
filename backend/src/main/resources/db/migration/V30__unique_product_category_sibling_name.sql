UPDATE product_categories SET name = TRIM(name);

ALTER TABLE product_categories
ADD COLUMN parent_scope_key BIGINT
  GENERATED ALWAYS AS (COALESCE(parent_id, 0)) STORED,
ADD CONSTRAINT uk_product_categories_scope_parent_name
  UNIQUE (scope, parent_scope_key, name);
