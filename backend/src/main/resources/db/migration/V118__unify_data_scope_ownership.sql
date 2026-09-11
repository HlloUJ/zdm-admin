-- Unknown historical creators remain NULL; self scope must not claim these rows.
ALTER TABLE slab_guide_price_settings ADD COLUMN created_by_account_id BIGINT NULL;
CREATE INDEX idx_slab_guide_price_settings_creator_scope ON slab_guide_price_settings (created_by_account_id);
ALTER TABLE finished_guide_price_settings ADD COLUMN created_by_account_id BIGINT NULL;
CREATE INDEX idx_finished_guide_price_settings_creator_scope ON finished_guide_price_settings (created_by_account_id);
ALTER TABLE master_data ADD COLUMN created_by_account_id BIGINT NULL;
CREATE INDEX idx_master_data_creator_scope ON master_data (created_by_account_id);
ALTER TABLE stores ADD COLUMN created_by_account_id BIGINT NULL;
CREATE INDEX idx_stores_creator_scope ON stores (created_by_account_id);
ALTER TABLE store_categories ADD COLUMN created_by_account_id BIGINT NULL;
CREATE INDEX idx_store_categories_creator_scope ON store_categories (created_by_account_id);
ALTER TABLE slab_operation_logs ADD COLUMN product_created_by_account_id BIGINT NULL;
UPDATE slab_operation_logs log JOIN slab_inventory product ON product.id = log.slab_id SET log.product_created_by_account_id = product.created_by_account_id;
CREATE INDEX idx_slab_operation_logs_scope ON slab_operation_logs (product_created_by_account_id);
ALTER TABLE finished_operation_logs ADD COLUMN product_created_by_account_id BIGINT NULL;
UPDATE finished_operation_logs log JOIN finished_products product ON product.id = log.product_id SET log.product_created_by_account_id = product.created_by_account_id;
CREATE INDEX idx_finished_operation_logs_scope ON finished_operation_logs (product_created_by_account_id);
