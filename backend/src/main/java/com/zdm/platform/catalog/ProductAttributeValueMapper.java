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
        COUNT(binding.id) AS use_count
      FROM product_attribute_values attribute_value
      LEFT JOIN category_attribute_value_bindings binding
        ON binding.attribute_value_id = attribute_value.id
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
