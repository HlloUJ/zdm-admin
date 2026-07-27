ALTER TABLE crafts ADD COLUMN width VARCHAR(40) AFTER type;
ALTER TABLE crafts ADD COLUMN remark VARCHAR(255) AFTER pricing_method;

UPDATE crafts
SET width = '5',
    remark = '系统内置工艺'
WHERE id = 1;
