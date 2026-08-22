package com.zdm.platform.media;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.time.LocalDateTime;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface MediaCleanupRunMapper extends BaseMapper<MediaCleanupRun> {
  @Select("SELECT MAX(finished_at) FROM media_cleanup_runs WHERE status = 'success'")
  LocalDateTime selectLastSuccessfulFinish();
}
