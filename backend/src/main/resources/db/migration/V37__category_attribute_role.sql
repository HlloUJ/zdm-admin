ALTER TABLE category_attributes
  ADD COLUMN attribute_role VARCHAR(20) NULL AFTER attribute_id;

UPDATE category_attributes
SET attribute_role = 'sales'
WHERE sku_flag = 1;
