-- Remove the original product-attribute demo records only while they are still untouched.
-- Any attribute referenced by a category template or extended with custom values is preserved.
DELETE pav
FROM product_attribute_values pav
JOIN product_attributes pa ON pa.id = pav.attribute_id
LEFT JOIN category_attributes ca ON ca.attribute_id = pa.id
LEFT JOIN product_attribute_values custom_value
  ON custom_value.attribute_id = pa.id
  AND NOT (
    (pa.id = 1 AND custom_value.code IN ('natural-stone', 'sintered-stone'))
    OR (pa.id = 3 AND custom_value.code = 'black')
  )
WHERE ca.id IS NULL
  AND custom_value.id IS NULL
  AND (
    (
      pa.id = 1
      AND pa.scope = 'shared'
      AND pa.name = '材质'
      AND pa.value_type = 'select'
      AND pa.attribute_role = 'basic'
      AND pa.status = 'enabled'
      AND pav.scope = 'shared'
      AND (
        (pav.value = '天然石材' AND pav.code = 'natural-stone')
        OR (pav.value = '岩板' AND pav.code = 'sintered-stone')
      )
    )
    OR (
      pa.id = 3
      AND pa.scope = 'accessory'
      AND pa.name = '颜色'
      AND pa.value_type = 'select'
      AND pa.attribute_role = 'sales'
      AND pa.status = 'enabled'
      AND pav.scope = 'accessory'
      AND pav.value = '黑色'
      AND pav.code = 'black'
    )
  );

DELETE pa
FROM product_attributes pa
LEFT JOIN product_attribute_values pav ON pav.attribute_id = pa.id
LEFT JOIN category_attributes ca ON ca.attribute_id = pa.id
WHERE pav.id IS NULL
  AND ca.id IS NULL
  AND (
    (
      pa.id = 1
      AND pa.scope = 'shared'
      AND pa.name = '材质'
      AND pa.value_type = 'select'
      AND pa.attribute_role = 'basic'
      AND pa.status = 'enabled'
    )
    OR (
      pa.id = 2
      AND pa.scope = 'finished'
      AND pa.name = '尺寸'
      AND pa.value_type = 'text'
      AND pa.attribute_role = 'sales'
      AND pa.status = 'enabled'
    )
    OR (
      pa.id = 3
      AND pa.scope = 'accessory'
      AND pa.name = '颜色'
      AND pa.value_type = 'select'
      AND pa.attribute_role = 'sales'
      AND pa.status = 'enabled'
    )
  );
