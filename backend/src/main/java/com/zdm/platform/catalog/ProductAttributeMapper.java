package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface ProductAttributeMapper extends BaseMapper<ProductAttribute> {
  @Select("""
      SELECT
        pa.id,
        pa.scope,
        pa.name,
        pa.value_type,
        pa.attribute_role,
        pa.status,
        pa.created_by_name,
        pa.created_at,
        pa.updated_at,
        COUNT(ca.id) AS template_count
      FROM product_attributes pa
      LEFT JOIN category_attributes ca ON ca.attribute_id = pa.id
      GROUP BY
        pa.id,
        pa.scope,
        pa.name,
        pa.value_type,
        pa.attribute_role,
        pa.status,
        pa.created_by_name,
        pa.created_at,
        pa.updated_at
      ORDER BY pa.created_at DESC, pa.id DESC
      """)
  List<ProductAttribute> selectWithTemplateCounts();
}
