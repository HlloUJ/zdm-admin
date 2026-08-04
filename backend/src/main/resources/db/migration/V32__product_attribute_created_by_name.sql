ALTER TABLE product_attributes ADD COLUMN created_by_name VARCHAR(80) AFTER status;

UPDATE product_attributes
SET created_by_name = '韩健'
WHERE created_by_name IS NULL OR created_by_name = '';
