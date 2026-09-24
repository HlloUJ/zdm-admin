ALTER TABLE store_finished_products
  DROP FOREIGN KEY fk_store_finished_store,
  ADD CONSTRAINT fk_store_finished_store_cascade FOREIGN KEY (store_id)
    REFERENCES stores (id) ON DELETE CASCADE;

ALTER TABLE store_finished_role_price_configurations
  DROP FOREIGN KEY fk_store_finished_role_config_store,
  ADD CONSTRAINT fk_store_finished_role_config_store_cascade FOREIGN KEY (store_id)
    REFERENCES stores (id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_store_finished_role_config_role FOREIGN KEY (role_id)
    REFERENCES roles (id) ON DELETE CASCADE;

ALTER TABLE store_finished_role_price_overrides
  ADD CONSTRAINT fk_store_finished_role_price_role FOREIGN KEY (role_id)
    REFERENCES roles (id) ON DELETE CASCADE;
