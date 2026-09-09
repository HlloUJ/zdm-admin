CREATE TABLE category_template_versions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  category_id BIGINT NOT NULL,
  kind VARCHAR(20) NOT NULL,
  attribute_version_id BIGINT NULL,
  version_no INT NULL,
  base_version_id BIGINT NULL,
  draft_kind VARCHAR(20) GENERATED ALWAYS AS (CASE WHEN state = 'draft' THEN kind ELSE NULL END) STORED,
  state VARCHAR(20) NOT NULL DEFAULT 'draft',
  revision INT NOT NULL DEFAULT 0,
  content JSON NOT NULL,
  created_by_name VARCHAR(80) NOT NULL,
  published_by_name VARCHAR(80) NULL,
  change_note VARCHAR(500) NOT NULL DEFAULT '',
  created_by_account_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_template_draft (category_id, draft_kind),
  CONSTRAINT fk_template_base FOREIGN KEY (base_version_id) REFERENCES category_template_versions(id),
  UNIQUE KEY uk_template_version (category_id, kind, version_no),
  CONSTRAINT fk_template_category FOREIGN KEY (category_id) REFERENCES product_categories(id),
  CONSTRAINT fk_sku_attribute_version FOREIGN KEY (attribute_version_id) REFERENCES category_template_versions(id),
  CONSTRAINT ck_template_kind CHECK (kind IN ('attributes', 'sku')),
  CONSTRAINT ck_template_state CHECK (state IN ('draft', 'published'))
);

-- Preserve the original binding configuration as immutable JSON, including names and option values.
INSERT INTO category_template_versions (category_id, kind, version_no, state, content, created_by_name, published_at)
SELECT ca.category_id, 'attributes', 1, 'published',
 JSON_ARRAYAGG(JSON_OBJECT('attributeId', ca.attribute_id, 'name', a.name, 'scope', a.scope,
 'valueType', a.value_type, 'attributeRole', ca.attribute_role, 'requiredFlag', IF(ca.required_flag, CAST('true' AS JSON), CAST('false' AS JSON)),
 'sortOrder', ca.sort_order, 'options', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('id', av.id, 'value', av.value, 'code', av.code))
 FROM category_attribute_value_bindings b JOIN product_attribute_values av ON av.id = b.attribute_value_id
 WHERE b.category_attribute_id = ca.id), JSON_ARRAY()))), '历史配置迁移', CURRENT_TIMESTAMP
FROM category_attributes ca JOIN product_attributes a ON a.id = ca.attribute_id
JOIN product_categories c ON c.id = ca.category_id AND c.tenant_id IS NULL AND c.scope IN ('finished', 'accessory')
WHERE ca.publish_status = 'published'
GROUP BY ca.category_id;

-- Unpublished work remains a draft; it is never silently published.
INSERT INTO category_template_versions (category_id, kind, version_no, content, created_by_name)
SELECT ca.category_id, 'attributes', NULL,
 JSON_ARRAYAGG(JSON_OBJECT('attributeId', ca.attribute_id, 'name', a.name, 'scope', a.scope,
 'valueType', a.value_type, 'attributeRole', ca.attribute_role, 'requiredFlag', IF(ca.required_flag, CAST('true' AS JSON), CAST('false' AS JSON)),
 'sortOrder', ca.sort_order, 'options', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('id', av.id, 'value', av.value, 'code', av.code))
 FROM category_attribute_value_bindings b JOIN product_attribute_values av ON av.id = b.attribute_value_id
 WHERE b.category_attribute_id = ca.id), JSON_ARRAY()))), '历史配置迁移'
FROM category_attributes ca JOIN product_attributes a ON a.id = ca.attribute_id
JOIN product_categories c ON c.id = ca.category_id AND c.tenant_id IS NULL AND c.scope IN ('finished', 'accessory')
WHERE EXISTS(SELECT 1 FROM category_attributes draft WHERE draft.category_id = ca.category_id AND draft.publish_status <> 'published')
GROUP BY ca.category_id;

INSERT INTO category_template_versions (category_id, kind, attribute_version_id, version_no, state, content, created_by_name, published_at)
SELECT ca.category_id, 'sku', t.id, 1, 'published', CAST(CONCAT('[', GROUP_CONCAT(ca.attribute_id ORDER BY ca.sort_order, ca.id SEPARATOR ','), ']') AS JSON), '历史配置迁移', CURRENT_TIMESTAMP
FROM category_attributes ca JOIN category_template_versions t ON t.category_id = ca.category_id AND t.kind = 'attributes' AND t.state = 'published'
WHERE ca.publish_status = 'published' AND ca.attribute_role = 'sales' AND ca.sku_flag = 1
GROUP BY ca.category_id, t.id;


UPDATE category_template_versions SET published_by_name = created_by_name WHERE state = 'published';
UPDATE category_template_versions d JOIN category_template_versions p
 ON p.category_id = d.category_id AND p.kind = d.kind AND p.state = 'published'
SET d.base_version_id = p.id WHERE d.state = 'draft';
-- Product consumers stay on the legacy records until their separate version-adoption task.
-- No product references are inferred here: historical unpublished bindings may still be in use.
