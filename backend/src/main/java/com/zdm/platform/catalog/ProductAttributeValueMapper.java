package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface ProductAttributeValueMapper extends BaseMapper<ProductAttributeValue> {
  @Select("""
      SELECT
        attribute_value.id,
        attribute_value.attribute_id,
        attribute_value.scope,
        attribute_value.value,
        attribute_value.code,
        attribute_value.status,
        attribute_value.created_by_name,
        attribute_value.created_by_account_id,
        attribute_value.created_at,
        attribute_value.updated_at,
        (SELECT COUNT(DISTINCT template.category_id)
         FROM category_template_versions template,
           JSON_TABLE(template.content, '$[*].options[*]' COLUMNS(value_id BIGINT PATH '$.id')) binding
         WHERE binding.value_id = attribute_value.id) AS use_count
      FROM product_attribute_values attribute_value
      JOIN product_attributes attribute
        ON attribute.id = attribute_value.attribute_id
       AND attribute.deleted_at IS NULL
      GROUP BY
        attribute_value.id,
        attribute_value.attribute_id,
        attribute_value.scope,
        attribute_value.value,
        attribute_value.code,
        attribute_value.status,
        attribute_value.created_by_name,
        attribute_value.created_by_account_id,
        attribute_value.created_at,
        attribute_value.updated_at
      ORDER BY attribute_value.created_at DESC, attribute_value.id DESC
      """)
  List<ProductAttributeValue> selectWithUseCounts();
}
