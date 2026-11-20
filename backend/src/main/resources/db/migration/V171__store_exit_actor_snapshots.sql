ALTER TABLE store_exit_operations
  ADD COLUMN store_created_by_account_id BIGINT NULL AFTER tenant_name;

CREATE TABLE store_exit_actor_snapshots (
  account_id BIGINT PRIMARY KEY,
  display_name_at_exit VARCHAR(200) NOT NULL,
  captured_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
