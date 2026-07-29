ALTER TABLE stores ALTER COLUMN created_by SET DEFAULT '韩健';

UPDATE stores
SET created_by = '韩健'
WHERE created_by IS NULL OR created_by = '' OR created_by = '系统管理员' OR created_by = '超级管理员';
