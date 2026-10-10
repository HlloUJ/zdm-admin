-- Business creator display names come from accounts; historical operation-log names are untouched.
-- Resolve only unambiguous legacy names before removing the duplicate columns.
-- V1 creates tenant 1 for the built-in account 1; V57 labels its creator 韩健,
-- but V58 added the creator ID without backfilling this initializer record.
UPDATE tenants SET created_by_account_id=1
  WHERE id=1 AND account_id=1 AND created_by_account_id IS NULL AND created_by_name='韩健';
UPDATE category_template_versions business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE crafts business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE employee_invites business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE employees business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE finished_markup_configurations business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE finished_products business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE product_attribute_values business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE product_attributes business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE product_categories business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE roles business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE slab_color_categories business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE slab_colors business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE slab_grades business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE slab_inventory business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE slab_markup_configurations business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE slab_origins business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE slab_textures business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE slab_varieties business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE store_categories business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE store_levels business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE supplier_supply_types business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE suppliers business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
UPDATE tenants business JOIN (SELECT display_name, MIN(id) AS account_id FROM accounts
  GROUP BY display_name HAVING COUNT(*)=1) creator ON creator.display_name=business.created_by_name
  SET business.created_by_account_id=creator.account_id WHERE business.created_by_account_id IS NULL;
DELIMITER //
CREATE PROCEDURE validate_business_creator_accounts()
BEGIN
  IF EXISTS (SELECT 1 FROM category_template_versions business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in category_template_versions before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM crafts business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in crafts before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM employee_invites business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in employee_invites before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM employees business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in employees before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM finished_markup_configurations business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in finished_markup_configurations before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM finished_products business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in finished_products before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM product_attribute_values business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in product_attribute_values before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM product_attributes business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in product_attributes before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM product_categories business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in product_categories before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM roles business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in roles before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM slab_color_categories business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in slab_color_categories before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM slab_colors business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in slab_colors before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM slab_grades business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in slab_grades before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM slab_inventory business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL AND business.publisher_type <> '接口获取') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in slab_inventory before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM slab_markup_configurations business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in slab_markup_configurations before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM slab_origins business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in slab_origins before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM slab_textures business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in slab_textures before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM slab_varieties business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in slab_varieties before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM store_categories business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in store_categories before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM store_levels business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in store_levels before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM supplier_supply_types business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in supplier_supply_types before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM suppliers business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in suppliers before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM tenants business LEFT JOIN accounts creator ON creator.id=business.created_by_account_id
      WHERE creator.id IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve missing creator account in tenants before cleanup';
  END IF;
END//
DELIMITER ;
CALL validate_business_creator_accounts();
DROP PROCEDURE validate_business_creator_accounts;
ALTER TABLE category_template_versions DROP COLUMN created_by_name;
ALTER TABLE crafts DROP COLUMN created_by_name;
ALTER TABLE employee_invites DROP COLUMN created_by_name;
ALTER TABLE employees DROP COLUMN created_by_name;
ALTER TABLE finished_markup_configurations DROP COLUMN created_by_name;
ALTER TABLE finished_products DROP COLUMN created_by_name;
ALTER TABLE product_attribute_values DROP COLUMN created_by_name;
ALTER TABLE product_attributes DROP COLUMN created_by_name;
ALTER TABLE product_categories DROP COLUMN created_by_name;
ALTER TABLE roles DROP COLUMN created_by_name;
ALTER TABLE slab_color_categories DROP COLUMN created_by_name;
ALTER TABLE slab_colors DROP COLUMN created_by_name;
ALTER TABLE slab_grades DROP COLUMN created_by_name;
ALTER TABLE slab_inventory DROP COLUMN created_by_name;
ALTER TABLE slab_markup_configurations DROP COLUMN created_by_name;
ALTER TABLE slab_origins DROP COLUMN created_by_name;
ALTER TABLE slab_textures DROP COLUMN created_by_name;
ALTER TABLE slab_varieties DROP COLUMN created_by_name;
ALTER TABLE store_categories DROP COLUMN created_by_name;
ALTER TABLE store_levels DROP COLUMN created_by_name;
ALTER TABLE supplier_supply_types DROP COLUMN created_by_name;
ALTER TABLE suppliers DROP COLUMN created_by_name;
ALTER TABLE tenants DROP COLUMN created_by_name;
