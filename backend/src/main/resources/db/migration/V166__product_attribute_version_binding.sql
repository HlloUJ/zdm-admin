-- Bind only the audited legacy products. No values, SKUs, state, timestamps or logs are rewritten.

ALTER TABLE finished_products
  ADD COLUMN template_version_id BIGINT NULL,
  ADD COLUMN template_revision INT NULL,
  ADD COLUMN attribute_template_snapshot JSON NULL,
  ADD INDEX idx_finished_template_version(template_version_id);

ALTER TABLE accessory_products
  ADD COLUMN template_version_id BIGINT NULL,
  ADD COLUMN template_revision INT NULL,
  ADD COLUMN attribute_template_snapshot JSON NULL,
  ADD INDEX idx_accessory_template_version(template_version_id);

UPDATE finished_products p
JOIN category_template_versions v ON v.id=26 AND v.category_id=p.category_id AND v.version_no=2 AND v.state='published'
JOIN product_categories c ON c.id=p.category_id AND c.scope='finished' AND c.tenant_id IS NULL
SET p.template_version_id=v.id,p.template_revision=v.revision,p.attribute_template_snapshot=v.content,p.updated_at=p.updated_at
WHERE p.id IN (58,59,60,61,62,63) AND p.category_id=79 AND p.template_version_id IS NULL
  AND JSON_EXTRACT(p.attribute_display_order,'$.product')=CAST('["53", "55", "56", "60", "61", "62"]' AS JSON)
  AND JSON_EXTRACT(p.attribute_display_order,'$.sales')=CAST('["attribute_57", "attribute_58", "attribute_59", "attribute_63", "attribute_64", "attribute_65"]' AS JSON)
  AND JSON_LENGTH(v.content)=12
  AND NOT EXISTS (SELECT 1 FROM JSON_TABLE(v.content,'$[*]' COLUMNS(attribute_id BIGINT PATH '$.attributeId')) f WHERE f.attribute_id NOT IN (53,55,56,60,61,62,57,58,59,63,64,65))
  AND EXISTS (SELECT 1 FROM finished_operation_logs l WHERE l.product_id=p.id AND l.operation_type='CREATE'
      AND l.business_client_code='supply-chain'
      AND JSON_EXTRACT(l.change_details,'$."字段顺序".after')=p.attribute_display_order)
  AND (SELECT COUNT(*) FROM finished_product_attribute_entries a WHERE a.finished_product_id=p.id)=6
  AND NOT EXISTS (SELECT 1 FROM finished_product_attribute_entries a WHERE a.finished_product_id=p.id AND a.attribute_id NOT IN (53,55,56,60,61,62))
  AND NOT EXISTS (SELECT 1 FROM finished_product_variants s JOIN JSON_TABLE(JSON_KEYS(s.sales_attributes),'$[*]' COLUMNS(field_key VARCHAR(100) PATH '$')) f WHERE s.finished_product_id=p.id AND f.field_key NOT IN ('attribute_57','attribute_58','attribute_59','attribute_63','attribute_64','attribute_65'));

UPDATE accessory_products p
JOIN category_template_versions v ON v.id=29 AND v.category_id=p.category_id AND v.version_no=1 AND v.state='published'
JOIN product_categories c ON c.id=p.category_id AND c.scope='accessory' AND c.tenant_id IS NULL
SET p.template_version_id=v.id,p.template_revision=v.revision,p.attribute_template_snapshot=v.content,p.updated_at=p.updated_at
WHERE p.id IN (3,4,5) AND p.category_id=98 AND p.template_version_id IS NULL
  AND JSON_EXTRACT(p.attribute_display_order,'$.product')=CAST('["53", "55", "56", "74", "75", "76"]' AS JSON)
  AND JSON_EXTRACT(p.attribute_display_order,'$.sales')=CAST('["attribute_57", "attribute_58", "attribute_59", "attribute_77", "attribute_78", "attribute_79"]' AS JSON)
  AND JSON_LENGTH(v.content)=12
  AND NOT EXISTS (SELECT 1 FROM JSON_TABLE(v.content,'$[*]' COLUMNS(attribute_id BIGINT PATH '$.attributeId')) f WHERE f.attribute_id NOT IN (53,55,56,74,75,76,57,58,59,77,78,79))
  AND EXISTS (SELECT 1 FROM accessory_operation_logs l WHERE l.product_id=p.id AND l.operation_type='CREATE'
      AND l.business_client_code='supply-chain'
      AND JSON_EXTRACT(l.change_details,'$."字段顺序".after')=p.attribute_display_order)
  AND (SELECT COUNT(*) FROM accessory_product_attribute_entries a WHERE a.accessory_product_id=p.id)=6
  AND NOT EXISTS (SELECT 1 FROM accessory_product_attribute_entries a WHERE a.accessory_product_id=p.id AND a.attribute_id NOT IN (53,55,56,74,75,76))
  AND NOT EXISTS (SELECT 1 FROM accessory_product_variants s JOIN JSON_TABLE(JSON_KEYS(s.sales_attributes),'$[*]' COLUMNS(field_key VARCHAR(100) PATH '$')) f WHERE s.accessory_product_id=p.id AND f.field_key NOT IN ('attribute_57','attribute_58','attribute_59','attribute_77','attribute_78','attribute_79'));

UPDATE accessory_products p
JOIN category_template_versions v ON v.id=34 AND v.category_id=p.category_id AND v.version_no=1 AND v.state='published'
JOIN product_categories c ON c.id=p.category_id AND c.scope='accessory' AND c.tenant_id IS NULL
SET p.template_version_id=v.id,p.template_revision=v.revision,p.attribute_template_snapshot=v.content,p.updated_at=p.updated_at
WHERE p.id IN (6) AND p.category_id=110 AND p.template_version_id IS NULL
  AND JSON_EXTRACT(p.attribute_display_order,'$.product')=CAST('["53", "55"]' AS JSON)
  AND JSON_EXTRACT(p.attribute_display_order,'$.sales')=CAST('["attribute_56", "attribute_57"]' AS JSON)
  AND JSON_LENGTH(v.content)=4
  AND NOT EXISTS (SELECT 1 FROM JSON_TABLE(v.content,'$[*]' COLUMNS(attribute_id BIGINT PATH '$.attributeId')) f WHERE f.attribute_id NOT IN (53,55,56,57))
  AND EXISTS (SELECT 1 FROM accessory_operation_logs l WHERE l.product_id=p.id AND l.operation_type='CREATE'
      AND l.business_client_code='supply-chain'
      AND JSON_EXTRACT(l.change_details,'$."字段顺序".after')=p.attribute_display_order)
  AND (SELECT COUNT(*) FROM accessory_product_attribute_entries a WHERE a.accessory_product_id=p.id)=2
  AND NOT EXISTS (SELECT 1 FROM accessory_product_attribute_entries a WHERE a.accessory_product_id=p.id AND a.attribute_id NOT IN (53,55))
  AND NOT EXISTS (SELECT 1 FROM accessory_product_variants s JOIN JSON_TABLE(JSON_KEYS(s.sales_attributes),'$[*]' COLUMNS(field_key VARCHAR(100) PATH '$')) f WHERE s.accessory_product_id=p.id AND f.field_key NOT IN ('attribute_56','attribute_57'));

UPDATE accessory_products p
JOIN category_template_versions v ON v.id=35 AND v.category_id=p.category_id AND v.version_no=2 AND v.state='published'
JOIN product_categories c ON c.id=p.category_id AND c.scope='accessory' AND c.tenant_id IS NULL
SET p.template_version_id=v.id,p.template_revision=v.revision,p.attribute_template_snapshot=v.content,p.updated_at=p.updated_at
WHERE p.id IN (7,8) AND p.category_id=110 AND p.template_version_id IS NULL
  AND JSON_EXTRACT(p.attribute_display_order,'$.product')=CAST('["53", "55"]' AS JSON)
  AND JSON_EXTRACT(p.attribute_display_order,'$.sales')=CAST('["attribute_57", "attribute_58"]' AS JSON)
  AND JSON_LENGTH(v.content)=4
  AND NOT EXISTS (SELECT 1 FROM JSON_TABLE(v.content,'$[*]' COLUMNS(attribute_id BIGINT PATH '$.attributeId')) f WHERE f.attribute_id NOT IN (53,55,57,58))
  AND EXISTS (SELECT 1 FROM accessory_operation_logs l WHERE l.product_id=p.id AND l.operation_type='CREATE'
      AND l.business_client_code='supply-chain'
      AND JSON_EXTRACT(l.change_details,'$."字段顺序".after')=p.attribute_display_order)
  AND (SELECT COUNT(*) FROM accessory_product_attribute_entries a WHERE a.accessory_product_id=p.id)=2
  AND NOT EXISTS (SELECT 1 FROM accessory_product_attribute_entries a WHERE a.accessory_product_id=p.id AND a.attribute_id NOT IN (53,55))
  AND NOT EXISTS (SELECT 1 FROM accessory_product_variants s JOIN JSON_TABLE(JSON_KEYS(s.sales_attributes),'$[*]' COLUMNS(field_key VARCHAR(100) PATH '$')) f WHERE s.accessory_product_id=p.id AND f.field_key NOT IN ('attribute_57','attribute_58'));
