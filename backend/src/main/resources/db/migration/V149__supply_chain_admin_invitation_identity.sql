-- Invitation purpose is assigned by the issuer identity, never by registration input.
-- Existing invitations remain ordinary employee invitations and cannot grant administrator status.
ALTER TABLE employee_invites
  ADD COLUMN target_identity_type VARCHAR(40) NOT NULL DEFAULT 'employee',
  ADD CONSTRAINT chk_employee_invite_target CHECK (
    target_identity_type = 'employee'
    OR (target_identity_type = 'supply_chain_admin' AND client_code = 'supply-chain'
        AND tenant_id IS NULL AND store_id IS NULL)
  );
