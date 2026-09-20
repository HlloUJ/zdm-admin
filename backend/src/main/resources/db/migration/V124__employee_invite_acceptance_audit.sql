-- Preserve the issuing identity and accepted unified account without changing permissions.
ALTER TABLE employee_invites
  ADD COLUMN created_by_identity_id BIGINT NULL,
  ADD COLUMN accepted_account_id BIGINT NULL;

-- Existing unused links must also respect the five-minute validity limit.
UPDATE employee_invites
SET expires_at = LEAST(expires_at, DATE_ADD(created_at, INTERVAL 5 MINUTE))
WHERE status = 'active';
