-- Retire the independent specification template feature; retain attribute snapshots.
UPDATE category_template_versions SET base_version_id = NULL WHERE kind = 'sku';
DELETE FROM category_template_versions WHERE kind = 'sku';

ALTER TABLE category_template_versions
  DROP FOREIGN KEY fk_sku_attribute_version,
  DROP FOREIGN KEY fk_template_base,
  DROP CHECK ck_template_kind,
  DROP INDEX uk_template_draft,
  DROP INDEX uk_template_version,
  DROP COLUMN draft_kind,
  DROP COLUMN attribute_version_id,
  DROP COLUMN base_version_id,
  DROP COLUMN kind,
  ADD COLUMN draft_slot TINYINT GENERATED ALWAYS AS (CASE WHEN state = 'draft' THEN 1 ELSE NULL END) STORED,
  ADD UNIQUE KEY uk_template_draft (category_id, draft_slot),
  ADD UNIQUE KEY uk_template_version (category_id, version_no);

UPDATE roles
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',admin[.]product-data-center[.]category-attribute-template[.](finished|accessory)[.]sku[.](view|create|save|publish|discard)(?=,)',
  ''));

UPDATE terminal_function_policies
SET function_permissions = TRIM(BOTH ',' FROM REGEXP_REPLACE(
  CONCAT(',', COALESCE(function_permissions, ''), ','),
  ',admin[.]product-data-center[.]category-attribute-template[.](finished|accessory)[.]sku[.](view|create|save|publish|discard)(?=,)',
  ''));
