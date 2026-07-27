ALTER TABLE stores ADD COLUMN shop_level VARCHAR(30) AFTER type;
ALTER TABLE stores ADD COLUMN manager VARCHAR(80) AFTER shop_level;
ALTER TABLE stores ADD COLUMN detail_address VARCHAR(255) AFTER region;
ALTER TABLE stores ADD COLUMN remark VARCHAR(255) AFTER status;

UPDATE stores
SET type = 'cityPartner',
    shop_level = 'level1',
    manager = '系统管理员',
    region = 'xihu',
    detail_address = '样例地址 1 号',
    address = '浙江省杭州市西湖区样例地址 1 号',
    remark = '系统内置门店'
WHERE id = 1;
