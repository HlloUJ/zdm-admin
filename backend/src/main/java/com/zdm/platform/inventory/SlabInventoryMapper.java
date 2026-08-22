package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface SlabInventoryMapper extends BaseMapper<SlabInventory> {
  @Select("""
      SELECT si.*, variety.name AS variety_name, origin.name AS origin_name, supplier.name AS supplier_name
      FROM slab_inventory si
      LEFT JOIN slab_varieties variety ON variety.id = si.variety_id
      LEFT JOIN slab_origins origin ON origin.id = COALESCE(si.origin_id, variety.origin_id)
      LEFT JOIN suppliers supplier ON supplier.id = si.supplier_id
      ORDER BY si.created_at DESC, si.id DESC
      """)
  List<SlabInventory> selectListWithDetails();

  @Select("""
      SELECT COUNT(*) FROM slab_inventory
      WHERE main_image_url = #{url}
         OR scan_image_url = #{url}
         OR design_image_url = #{url}
         OR video_url = #{url}
         OR video_cover_url = #{url}
      """)
  long countMediaReferences(String url);
}
