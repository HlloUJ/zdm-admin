-- Attribute names identify one global definition, regardless of the page tab used to create it.
-- Existing duplicates must be reviewed before this migration rather than deleted automatically.
ALTER TABLE product_attributes
  DROP INDEX uk_product_attributes_scope_name,
  ADD UNIQUE KEY uk_product_attributes_name (name);
