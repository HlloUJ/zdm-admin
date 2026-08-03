ALTER TABLE slab_varieties ADD COLUMN created_by_name VARCHAR(80) AFTER status;

UPDATE slab_varieties
SET created_by_name = '韩健'
WHERE created_by_name IS NULL OR created_by_name = '';
