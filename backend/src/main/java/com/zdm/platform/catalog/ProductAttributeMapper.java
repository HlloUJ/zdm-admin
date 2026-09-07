package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface ProductAttributeMapper extends BaseMapper<ProductAttribute> {
  @Select("""
      SELECT *
      FROM product_attributes
      WHERE id = #{id}
        AND deleted_at IS NULL
      FOR UPDATE
      """)
  ProductAttribute selectActiveByIdForUpdate(@Param("id") Long id);

  @Select("""
      SELECT *
      FROM product_attributes
      WHERE id = #{id}
        AND deleted_at IS NULL
      FOR SHARE
      """)
  ProductAttribute selectActiveByIdForShare(@Param("id") Long id);

  @Select("""
      SELECT
        attribute.id,
        attribute.scope,
        attribute.name,
        attribute.value_type,
        attribute.attribute_role,
        attribute.status,
        attribute.created_by_name,
        attribute.created_by_account_id,
        attribute.created_at,
        attribute.updated_at,
        COUNT(category_attribute.id) AS template_count
      FROM product_attributes attribute
      LEFT JOIN category_attributes category_attribute
        ON category_attribute.attribute_id = attribute.id
      WHERE attribute.deleted_at IS NULL
      GROUP BY
        attribute.id,
        attribute.scope,
        attribute.name,
        attribute.value_type,
        attribute.attribute_role,
        attribute.status,
        attribute.created_by_name,
        attribute.created_by_account_id,
        attribute.created_at,
        attribute.updated_at
      ORDER BY attribute.created_at DESC, attribute.id DESC
      """)
  List<ProductAttribute> selectWithTemplateCounts();
}
