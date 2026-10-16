-- Preserve existing role IDs, codes, grants, employee/account links and price-rule references.
ALTER TABLE roles ADD COLUMN builtin_key VARCHAR(40) NULL AFTER code;
UPDATE roles SET builtin_key='STORE_MANAGER',status='enabled'
WHERE client_code='admin' AND store_id IS NOT NULL AND name='店长';
INSERT INTO roles
  (client_code,tenant_id,store_id,name,code,builtin_key,data_scope,status,function_permissions,
   created_by_account_id,created_by_client_code)
SELECT 'admin',s.tenant_id,s.id,'店长',CONCAT('BUILTIN_STORE_MANAGER_',s.id),'STORE_MANAGER',
       'all','enabled','',s.created_by_account_id,'admin'
FROM stores s
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.client_code='admin' AND r.store_id=s.id AND r.builtin_key='STORE_MANAGER');
ALTER TABLE roles
  ADD UNIQUE KEY uk_roles_builtin_scope (client_code,role_scope_key,builtin_key),
  ADD CONSTRAINT chk_roles_builtin_manager CHECK (
    builtin_key IS NULL OR
    (builtin_key='STORE_MANAGER' AND client_code='admin' AND tenant_id IS NOT NULL
     AND store_id IS NOT NULL AND name='店长' AND status='enabled')
  );
