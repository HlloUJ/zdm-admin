ALTER TABLE store_categories
  DROP FOREIGN KEY fk_store_categories_store;

ALTER TABLE store_categories
  ADD CONSTRAINT fk_store_categories_store
    FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE;
