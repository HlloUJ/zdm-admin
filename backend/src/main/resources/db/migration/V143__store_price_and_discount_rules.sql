-- 新规则独立存储，旧成本倍数及商品手工价格原样保留，不转换为折扣。
CREATE TABLE store_price_rules (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  store_id BIGINT NOT NULL,
  kind VARCHAR(20) NOT NULL,
  category_id BIGINT NULL,
  role_id BIGINT NULL,
  coefficient DECIMAL(7,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_by_account_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  target_key BIGINT NOT NULL,
  UNIQUE KEY uk_store_price_rules_target (store_id, kind, target_key),
  CONSTRAINT chk_store_price_rules_kind CHECK (
    (kind = 'price' AND role_id IS NULL AND category_id IS NOT NULL AND target_key = category_id) OR
    (kind = 'discount' AND role_id IS NOT NULL AND category_id IS NULL AND target_key = role_id)
  ),
  CONSTRAINT chk_store_price_rules_coefficient CHECK (coefficient > 0 AND coefficient <= 999),
  CONSTRAINT chk_store_price_rules_status CHECK (status IN ('enabled', 'disabled')),
  CONSTRAINT fk_store_price_rules_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_store_price_rules_category FOREIGN KEY (category_id) REFERENCES store_categories(id) ON DELETE CASCADE,
  CONSTRAINT fk_store_price_rules_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);
