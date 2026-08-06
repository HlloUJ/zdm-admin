CREATE TABLE category_attribute_value_bindings (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  category_attribute_id BIGINT NOT NULL,
  attribute_value_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_category_attribute_value_binding (category_attribute_id, attribute_value_id),
  KEY idx_category_attribute_value_value (attribute_value_id),
  CONSTRAINT fk_category_attribute_value_category_attribute FOREIGN KEY (category_attribute_id)
    REFERENCES category_attributes (id) ON DELETE CASCADE,
  CONSTRAINT fk_category_attribute_value_attribute_value FOREIGN KEY (attribute_value_id)
    REFERENCES product_attribute_values (id) ON DELETE CASCADE
);
