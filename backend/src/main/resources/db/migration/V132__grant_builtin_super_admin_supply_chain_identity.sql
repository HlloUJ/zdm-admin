-- The built-in platform super administrator uses a separate supply-chain identity.
-- Its permissions come from the protected identity type, not assigned roles.
INSERT INTO account_identities
  (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
SELECT platform_identity.account_id, 'supply-chain', 'platform_admin',
       platform_identity.subject_id, NULL, NULL, 'enabled'
FROM account_identities platform_identity
JOIN accounts account ON account.id = platform_identity.account_id
WHERE account.id = 1
  AND account.phone = '15926626945'
  AND platform_identity.client_code = 'admin'
  AND platform_identity.identity_type = 'platform_admin'
  AND platform_identity.status = 'enabled'
  AND NOT EXISTS (
    SELECT 1 FROM account_identities supply_identity
    WHERE supply_identity.account_id = platform_identity.account_id
      AND supply_identity.client_code = 'supply-chain'
      AND supply_identity.identity_type = 'platform_admin'
  );
