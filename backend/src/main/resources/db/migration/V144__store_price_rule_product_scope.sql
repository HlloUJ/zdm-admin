-- 分类规则按已关联分类确定类型。无类型的历史折扣不自动分配或复制。
ALTER TABLE store_price_rules
  ADD COLUMN scope VARCHAR(20) NULL AFTER kind,
  DROP INDEX uk_store_price_rules_target,
  ADD UNIQUE KEY uk_store_price_rules_target (store_id, kind, scope, target_key),
  ADD CONSTRAINT chk_store_price_rules_scope CHECK (scope IS NULL OR scope IN ('finished', 'accessory'));
UPDATE store_price_rules rule
JOIN store_categories category ON category.id = rule.category_id AND category.store_id = rule.store_id
SET rule.scope = category.scope
WHERE rule.kind = 'price';
