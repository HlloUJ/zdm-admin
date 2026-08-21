package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface MarkupConfigurationMapper extends BaseMapper<MarkupConfiguration> {
  @Select("SELECT COUNT(*) FROM product_markup_price_snapshots WHERE markup_configuration_id = #{id}")
  long countProductReferences(Long id);
}
