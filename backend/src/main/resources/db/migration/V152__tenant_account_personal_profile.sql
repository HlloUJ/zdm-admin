-- Tenant name and contact fields are duplicate personal profile inputs in the current UI.
-- The user explicitly authorized their removal; account data is the sole profile authority.
DELIMITER //
CREATE PROCEDURE validate_tenant_owner_accounts()
BEGIN
  IF EXISTS (
    SELECT t.id FROM tenants t LEFT JOIN account_identities i
      ON i.tenant_id=t.id AND i.identity_type='tenant_admin'
      LEFT JOIN accounts a ON a.id=i.account_id
      GROUP BY t.id HAVING COUNT(DISTINCT a.id)<>1
  ) OR EXISTS (
    SELECT i.account_id FROM account_identities i JOIN tenants t ON t.id=i.tenant_id
      WHERE i.identity_type='tenant_admin' GROUP BY i.account_id HAVING COUNT(DISTINCT t.id)>1
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing or conflicting tenant owner accounts before migration';
  END IF;
END//
DELIMITER ;
CALL validate_tenant_owner_accounts();
DROP PROCEDURE validate_tenant_owner_accounts;

ALTER TABLE tenants ADD COLUMN account_id BIGINT NULL AFTER id;
UPDATE tenants t JOIN (
  SELECT tenant_id,MIN(account_id) AS account_id FROM account_identities
    WHERE identity_type='tenant_admin' GROUP BY tenant_id
) owner ON owner.tenant_id=t.id SET t.account_id=owner.account_id;
-- accounts.phone is unique; unique tenant account IDs preserve the one-tenant-per-phone rule.
ALTER TABLE tenants MODIFY account_id BIGINT NOT NULL,
  ADD UNIQUE KEY uk_tenants_account_id (account_id),
  ADD CONSTRAINT fk_tenants_account FOREIGN KEY (account_id) REFERENCES accounts(id),
  DROP INDEX uk_tenants_contact_phone,
  DROP COLUMN name, DROP COLUMN contact_name, DROP COLUMN contact_phone;
