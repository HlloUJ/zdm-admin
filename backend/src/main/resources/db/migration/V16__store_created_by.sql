ALTER TABLE stores ADD COLUMN created_by VARCHAR(80) DEFAULT '系统管理员' AFTER created_at;

UPDATE stores
SET created_by = '系统管理员'
WHERE created_by IS NULL OR created_by = '';
