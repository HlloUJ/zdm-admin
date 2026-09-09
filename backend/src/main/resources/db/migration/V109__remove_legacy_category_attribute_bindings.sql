-- Legacy per-attribute bindings are retired. Versioned templates remain untouched.
DROP TABLE category_attribute_value_bindings;
DROP TABLE category_attributes;

UPDATE roles
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',admin[.]product-data-center[.]category-attribute-template[.]((finished|accessory)[.])?(view|create|edit|delete|attribute-role|sku-combination|required|bind-values|toggle-publish)(?=,)',
  ''));

UPDATE terminal_function_policies
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',admin[.]product-data-center[.]category-attribute-template[.]((finished|accessory)[.])?(view|create|edit|delete|attribute-role|sku-combination|required|bind-values|toggle-publish)(?=,)',
  ''));
