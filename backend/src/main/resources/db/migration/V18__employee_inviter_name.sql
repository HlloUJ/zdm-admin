ALTER TABLE employee_invites ADD COLUMN created_by_account_id BIGINT AFTER store_id;
ALTER TABLE employee_invites ADD COLUMN created_by_name VARCHAR(80) AFTER created_by_account_id;
ALTER TABLE employee_invites ADD KEY idx_employee_invites_created_by_account_id (created_by_account_id);
ALTER TABLE employee_invites ADD CONSTRAINT fk_employee_invites_created_by_account
  FOREIGN KEY (created_by_account_id) REFERENCES accounts (id);

ALTER TABLE employees ADD COLUMN inviter_name VARCHAR(80) AFTER remark;

UPDATE employee_invites
SET created_by_account_id = 1,
    created_by_name = '韩健'
WHERE created_by_name IS NULL OR created_by_name = '';

UPDATE employees
SET inviter_name = '韩健'
WHERE inviter_name IS NULL OR inviter_name = '';
