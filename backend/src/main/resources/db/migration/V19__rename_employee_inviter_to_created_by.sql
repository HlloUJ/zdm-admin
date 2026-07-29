ALTER TABLE employees CHANGE COLUMN inviter_name created_by_name VARCHAR(80);

UPDATE employees
SET created_by_name = '韩健'
WHERE created_by_name IS NULL OR created_by_name = '';
