ALTER TABLE store_categories
  DROP INDEX uk_store_categories_parent_name,
  ADD COLUMN store_id BIGINT NULL AFTER id;

-- 现有分类的创建人均归属历史默认门店 1。
UPDATE store_categories SET store_id = 1 WHERE store_id IS NULL;

ALTER TABLE store_categories
  MODIFY COLUMN store_id BIGINT NOT NULL,
  ADD UNIQUE KEY uk_store_categories_store_parent_name (store_id, parent_scope_key, name),
  ADD KEY idx_store_categories_store_parent_sort (store_id, parent_id, sort_order),
  ADD CONSTRAINT fk_store_categories_store
    FOREIGN KEY (store_id) REFERENCES stores (id);
