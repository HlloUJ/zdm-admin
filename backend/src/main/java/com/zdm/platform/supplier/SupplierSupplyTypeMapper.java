package com.zdm.platform.supplier;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface SupplierSupplyTypeMapper extends BaseMapper<SupplierSupplyType> {
  @Select("SELECT COUNT(*) FROM supplier_supply_type_links WHERE supply_type_id = #{id}")
  long countSupplierReferences(Long id);
}
