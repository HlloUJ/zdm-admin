ALTER TABLE tenants ADD COLUMN business_types VARCHAR(255) AFTER status;
ALTER TABLE tenants ADD COLUMN remark VARCHAR(255) AFTER business_types;

UPDATE tenants
SET business_types = 'cityPartner',
    remark = '系统内置平台租户'
WHERE id = 1;
