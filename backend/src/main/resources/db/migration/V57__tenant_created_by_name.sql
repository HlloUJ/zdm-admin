ALTER TABLE tenants ADD COLUMN created_by_name VARCHAR(80) AFTER status;

UPDATE tenants
SET created_by_name = '韩健'
WHERE created_by_name IS NULL OR created_by_name = '';

ALTER TABLE tenants MODIFY COLUMN created_by_name VARCHAR(80) NOT NULL;
