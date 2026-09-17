-- Preserve unknown historical provenance rather than infer it from a shared account.
-- Supply-chain identities may modify only roles explicitly created within that client.
ALTER TABLE roles ADD COLUMN created_by_client_code VARCHAR(40) NULL AFTER created_by_account_id;
