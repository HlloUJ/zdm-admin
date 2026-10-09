package com.zdm.platform.store;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface StoreCategoryMapper extends BaseMapper<StoreCategory> {
  @org.apache.ibatis.annotations.Select("SELECT COUNT(*) FROM stores WHERE id = #{storeId} AND tenant_id = #{tenantId}")
  int countStore(@org.apache.ibatis.annotations.Param("storeId") Long storeId,
      @org.apache.ibatis.annotations.Param("tenantId") Long tenantId);
}
