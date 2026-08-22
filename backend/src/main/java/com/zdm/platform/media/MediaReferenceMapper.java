package com.zdm.platform.media;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.util.List;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface MediaReferenceMapper extends BaseMapper<MediaReference> {
  @Select("SELECT * FROM media_references WHERE business_domain = #{domain} AND business_id = #{businessId}")
  List<MediaReference> selectBusinessReferences(String domain, Long businessId);

  @Select("SELECT COUNT(*) FROM media_references WHERE media_id = #{mediaId}")
  long countByMediaId(Long mediaId);

  @Select("SELECT COUNT(*) FROM media_references")
  long countAll();

  @Delete("DELETE FROM media_references WHERE business_domain = #{domain} AND business_id = #{businessId}")
  int deleteBusinessReferences(String domain, Long businessId);
}
