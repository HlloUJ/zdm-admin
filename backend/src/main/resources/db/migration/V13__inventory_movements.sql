CREATE TABLE inventory_movements (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  inventory_type VARCHAR(30) NOT NULL,
  inventory_id BIGINT NOT NULL,
  movement_type VARCHAR(30) NOT NULL,
  quantity DECIMAL(12, 2) NOT NULL DEFAULT 0,
  before_quantity DECIMAL(12, 2),
  after_quantity DECIMAL(12, 2),
  reason VARCHAR(120),
  operator_id BIGINT,
  remark VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_inventory_movements_inventory (inventory_type, inventory_id),
  KEY idx_inventory_movements_operator_id (operator_id)
);
