ALTER TABLE suppliers ADD COLUMN remark VARCHAR(255) AFTER qualification_status;

UPDATE suppliers
SET remark = '系统内置供应商'
WHERE id IN (1, 2);
