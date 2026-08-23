ALTER TABLE suppliers ADD COLUMN created_by_name VARCHAR(80) AFTER status;

UPDATE suppliers
SET created_by_name = '韩健'
WHERE created_by_name IS NULL OR created_by_name = '';
