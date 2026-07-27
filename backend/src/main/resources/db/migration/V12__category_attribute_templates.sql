CREATE TABLE category_attributes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  category_id BIGINT NOT NULL,
  attribute_id BIGINT NOT NULL,
  required_flag TINYINT(1) NOT NULL DEFAULT 0,
  sku_flag TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_category_attribute (category_id, attribute_id),
  CONSTRAINT fk_category_attributes_category FOREIGN KEY (category_id) REFERENCES product_categories (id),
  CONSTRAINT fk_category_attributes_attribute FOREIGN KEY (attribute_id) REFERENCES product_attributes (id)
);
