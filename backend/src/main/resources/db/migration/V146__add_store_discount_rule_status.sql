-- 独立的折扣配置状态；价格系数分类不引入状态。
ALTER TABLE store_price_rules
  ADD COLUMN discount_status VARCHAR(20) NULL,
  ADD CONSTRAINT chk_store_discount_rule_status CHECK (discount_status IS NULL OR discount_status IN ('enabled','disabled'));
UPDATE store_price_rules SET discount_status = 'enabled' WHERE kind = 'discount';
