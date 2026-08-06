ALTER TABLE store_categories ADD COLUMN created_by_name VARCHAR(80) AFTER status;

UPDATE store_categories
SET created_by_name = '韩健'
WHERE created_by_name IS NULL OR created_by_name = '';
