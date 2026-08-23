package com.zdm.platform.media;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface MediaAssetMapper extends BaseMapper<MediaAsset> {
  @Select("SELECT * FROM media_assets WHERE public_id = #{publicId} AND status <> 'deleted'")
  MediaAsset selectAvailableByPublicId(String publicId);

  @Select("SELECT * FROM media_assets WHERE id = #{mediaId} FOR UPDATE")
  MediaAsset selectByIdForUpdate(Long mediaId);

  @Select("""
      SELECT * FROM media_assets
      WHERE status = 'temporary' AND created_at < #{deadline}
      ORDER BY id LIMIT #{limit}
      """)
  List<MediaAsset> selectExpiredTemporary(LocalDateTime deadline, int limit);

  @Select("""
      SELECT asset.* FROM media_assets asset
      LEFT JOIN media_references reference ON reference.media_id = asset.id
      WHERE asset.status IN ('active', 'pending_delete') AND reference.id IS NULL
      ORDER BY asset.id LIMIT #{limit}
      """)
  List<MediaAsset> selectUnreferenced(int limit);

  @Select("SELECT storage_key FROM media_assets WHERE status <> 'deleted'")
  List<String> selectRegisteredStorageKeys();

  @Select("""
      SELECT asset.storage_key FROM media_assets asset
      LEFT JOIN media_references reference ON reference.media_id = asset.id
      WHERE asset.status <> 'deleted' AND reference.id IS NULL
      ORDER BY asset.id
      """)
  List<String> selectUnreferencedStorageKeys();
}
