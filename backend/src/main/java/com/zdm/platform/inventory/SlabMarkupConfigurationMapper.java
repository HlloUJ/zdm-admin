package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface SlabMarkupConfigurationMapper extends BaseMapper<SlabMarkupConfiguration> {
  @Select("SELECT COUNT(*) FROM slab_prices WHERE markup_configuration_id = #{id}")
  long countProductReferences(Long id);
}
