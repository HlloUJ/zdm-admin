-- Existing invitations were issued only for admin-client store employees.
ALTER TABLE employee_invites
  ADD COLUMN client_code VARCHAR(40) NOT NULL DEFAULT 'admin' AFTER token,
  MODIFY COLUMN tenant_id BIGINT NULL,
  ADD KEY idx_employee_invites_client_scope (client_code, tenant_id, store_id);
