ALTER TABLE roles
  DROP INDEX uk_roles_name,
  ADD COLUMN tenant_id BIGINT NULL AFTER id,
  ADD COLUMN store_id BIGINT NULL AFTER tenant_id,
  ADD COLUMN role_scope_key VARCHAR(80)
    GENERATED ALWAYS AS (
      CASE
        WHEN store_id IS NULL THEN 'platform'
        ELSE CONCAT('store:', store_id)
      END
    ) STORED AFTER store_id,
  ADD UNIQUE KEY uk_roles_scope_name (role_scope_key, name),
  ADD KEY idx_roles_organization (tenant_id, store_id),
  ADD CONSTRAINT fk_roles_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  ADD CONSTRAINT fk_roles_store FOREIGN KEY (store_id) REFERENCES stores (id),
  ADD CONSTRAINT chk_roles_organization_scope CHECK (
    (tenant_id IS NULL AND store_id IS NULL)
    OR (tenant_id IS NOT NULL AND store_id IS NOT NULL)
  );
