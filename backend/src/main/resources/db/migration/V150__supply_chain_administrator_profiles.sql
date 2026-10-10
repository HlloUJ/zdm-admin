-- Administrator profile belongs to its supply-chain identity, not to other identities of the account.
CREATE TABLE supply_chain_admin_profiles (
  identity_id BIGINT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  gender VARCHAR(10) NULL,
  remark VARCHAR(100) NOT NULL DEFAULT '',
  CONSTRAINT fk_supply_admin_profile_identity FOREIGN KEY (identity_id)
    REFERENCES account_identities(id) ON DELETE CASCADE,
  CONSTRAINT chk_supply_admin_profile_gender CHECK (gender IS NULL OR gender IN ('male','female'))
);

INSERT INTO supply_chain_admin_profiles(identity_id,name)
SELECT ai.id,a.display_name FROM account_identities ai JOIN accounts a ON a.id=ai.account_id
WHERE ai.client_code='supply-chain' AND ai.identity_type='supply_chain_admin';
