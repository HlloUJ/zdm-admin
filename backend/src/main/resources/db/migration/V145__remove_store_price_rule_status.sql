-- 移除新门店价格规则的启停功能，保留分类/角色和已经设置的系数。
-- 运营平台及旧商品价格配置表不在本次范围。
ALTER TABLE store_price_rules
  DROP CHECK chk_store_price_rules_status,
  DROP COLUMN status;
