package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface CategoryAttributeValueBindingMapper extends BaseMapper<CategoryAttributeValueBinding> {
  @Select("""
      SELECT COUNT(*)
      FROM category_attribute_value_bindings binding
      JOIN product_attribute_values attribute_value ON attribute_value.id = binding.attribute_value_id
      WHERE binding.category_attribute_id = #{categoryAttributeId}
        AND attribute_value.status = 'enabled'
      """)
  long countEnabledBindings(@Param("categoryAttributeId") Long categoryAttributeId);

  @Select("""
      <script>
      SELECT binding.category_attribute_id AS categoryAttributeId, COUNT(*) AS optionCount
      FROM category_attribute_value_bindings binding
      JOIN product_attribute_values attribute_value ON attribute_value.id = binding.attribute_value_id
      WHERE binding.category_attribute_id IN
      <foreach collection="categoryAttributeIds" item="id" open="(" separator="," close=")">
        #{id}
      </foreach>
        AND attribute_value.status = 'enabled'
      GROUP BY binding.category_attribute_id
      </script>
      """)
  List<CategoryAttributeValueBindingCount> countEnabledBindingsByCategoryAttributeIds(
      @Param("categoryAttributeIds") List<Long> categoryAttributeIds);
}
