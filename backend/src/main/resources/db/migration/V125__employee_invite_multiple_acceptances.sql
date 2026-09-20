-- Keep each recipient's first successful acceptance independently from the link lifetime.
CREATE TABLE employee_invite_acceptances (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  invite_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  employee_id BIGINT NULL,
  employee_status VARCHAR(20) NULL,
  existing_employee BOOLEAN NULL,
  accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_employee_invite_acceptance (invite_id, account_id)
);

-- Preserve earlier one-use acceptance history without reopening those links.
INSERT INTO employee_invite_acceptances (invite_id, account_id, accepted_at)
SELECT id, accepted_account_id, used_at
FROM employee_invites
WHERE accepted_account_id IS NOT NULL AND used_at IS NOT NULL;
