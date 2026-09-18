-- Internal supply chain is a distinct client, not a supplier store.
INSERT INTO platform_clients (code, name, status)
VALUES ('supply-chain', '供应链协同系统', 'enabled');

ALTER TABLE employees
  ADD COLUMN client_code VARCHAR(40) NOT NULL DEFAULT 'admin' AFTER account_id,
  ADD KEY idx_employees_client_scope (client_code, tenant_id, store_id, account_id),
  ADD CONSTRAINT fk_employees_client FOREIGN KEY (client_code) REFERENCES platform_clients(code),
  ADD CONSTRAINT chk_employees_supply_chain_scope CHECK
    (client_code <> 'supply-chain' OR (tenant_id IS NULL AND store_id IS NULL));

ALTER TABLE roles
  ADD COLUMN client_code VARCHAR(40) NOT NULL DEFAULT 'admin' AFTER id,
  DROP INDEX uk_roles_scope_name,
  ADD UNIQUE KEY uk_roles_scope_name (client_code, role_scope_key, name),
  ADD CONSTRAINT fk_roles_client FOREIGN KEY (client_code) REFERENCES platform_clients(code),
  ADD CONSTRAINT chk_roles_supply_chain_scope CHECK
    (client_code <> 'supply-chain' OR (tenant_id IS NULL AND store_id IS NULL));

ALTER TABLE terminal_function_policies
  DROP CHECK chk_terminal_function_policies_terminal,
  ADD CONSTRAINT chk_terminal_function_policies_terminal
    CHECK (terminal IN ('store', 'supplier', 'supply-chain'));
INSERT INTO terminal_function_policies (terminal, function_permissions)
VALUES ('supply-chain', '');
