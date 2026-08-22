package com.zdm.platform.media;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface MediaCleanupTaskMapper extends BaseMapper<MediaCleanupTask> {
  @Select("""
      SELECT COUNT(*) FROM media_cleanup_tasks
      WHERE media_id = #{mediaId} AND status IN ('pending', 'processing', 'failed')
      """)
  long countOpenByMediaId(Long mediaId);

  @Select("""
      SELECT * FROM media_cleanup_tasks
      WHERE status = 'pending' OR (status = 'failed' AND next_retry_at <= #{now})
      ORDER BY id LIMIT #{limit}
      """)
  List<MediaCleanupTask> selectReady(LocalDateTime now, int limit);

  @Update("""
      UPDATE media_cleanup_tasks SET status = 'processing'
      WHERE id = #{taskId}
        AND (status = 'pending' OR (status = 'failed' AND next_retry_at <= NOW()))
      """)
  int claim(Long taskId);
}
