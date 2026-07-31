ALTER TABLE crafts ADD COLUMN created_by_name VARCHAR(80) AFTER status;

UPDATE crafts
SET created_by_name = '韩健'
WHERE created_by_name IS NULL OR created_by_name = '';
