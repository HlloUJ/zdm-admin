SET @product_attribute_creator_column_sql = IF(
  (SELECT COUNT(*)
   FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'product_attributes'
     AND column_name = 'created_by_name') = 0,
  'ALTER TABLE product_attributes ADD COLUMN created_by_name VARCHAR(80) AFTER status',
  'SELECT 1'
);
PREPARE product_attribute_creator_column_statement
FROM @product_attribute_creator_column_sql;
EXECUTE product_attribute_creator_column_statement;
DEALLOCATE PREPARE product_attribute_creator_column_statement;

UPDATE product_attributes
SET created_by_name = '韩健'
WHERE created_by_name IS NULL OR created_by_name = '';

SET @product_attribute_value_creator_column_sql = IF(
  (SELECT COUNT(*)
   FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'product_attribute_values'
     AND column_name = 'created_by_name') = 0,
  'ALTER TABLE product_attribute_values ADD COLUMN created_by_name VARCHAR(80) AFTER status',
  'SELECT 1'
);
PREPARE product_attribute_value_creator_column_statement
FROM @product_attribute_value_creator_column_sql;
EXECUTE product_attribute_value_creator_column_statement;
DEALLOCATE PREPARE product_attribute_value_creator_column_statement;

UPDATE product_attribute_values
SET created_by_name = '韩健'
WHERE created_by_name IS NULL OR created_by_name = '';
