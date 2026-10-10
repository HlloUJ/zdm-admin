-- 不设类型默认值，不回填历史分类；非空未分类旧库由检查约束阻止迁移。
ALTER TABLE store_categories
  DROP INDEX uk_store_categories_store_parent_name,
  ADD COLUMN scope VARCHAR(20) NOT NULL AFTER store_id,
  ADD CONSTRAINT chk_store_categories_scope CHECK (scope IN ('finished', 'accessory')),
  ADD UNIQUE KEY uk_store_categories_store_scope_parent_name (store_id, scope, parent_scope_key, name),
  ADD KEY idx_store_categories_store_scope_parent_sort (store_id, scope, parent_id, sort_order);
