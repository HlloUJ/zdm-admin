ALTER TABLE roles
  DROP INDEX uk_roles_category_name,
  ADD COLUMN store_id BIGINT NULL DEFAULT 1 AFTER client_code,
  ADD COLUMN store_scope_key BIGINT
    GENERATED ALWAYS AS (COALESCE(store_id, 0)) STORED AFTER store_id;

UPDATE roles SET store_id = NULL WHERE category = 'terminal-policy';

ALTER TABLE roles
  ADD UNIQUE KEY uk_roles_store_category_name (store_scope_key, category, name),
  ADD KEY idx_roles_store_category (store_id, category),
  ADD CONSTRAINT fk_roles_store FOREIGN KEY (store_id) REFERENCES stores (id);
