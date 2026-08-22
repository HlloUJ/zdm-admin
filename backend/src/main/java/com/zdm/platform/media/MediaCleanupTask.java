package com.zdm.platform.media;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import java.time.LocalDateTime;

@TableName("media_cleanup_tasks")
public class MediaCleanupTask extends BaseEntity {
  private Long mediaId;
  private String triggerType;
  private String reason;
  private Integer retryCount;
  private String lastError;
  private LocalDateTime nextRetryAt;

  public Long getMediaId() { return mediaId; }
  public void setMediaId(Long mediaId) { this.mediaId = mediaId; }
  public String getTriggerType() { return triggerType; }
  public void setTriggerType(String triggerType) { this.triggerType = triggerType; }
  public String getReason() { return reason; }
  public void setReason(String reason) { this.reason = reason; }
  public Integer getRetryCount() { return retryCount; }
  public void setRetryCount(Integer retryCount) { this.retryCount = retryCount; }
  public String getLastError() { return lastError; }
  public void setLastError(String lastError) { this.lastError = lastError; }
  public LocalDateTime getNextRetryAt() { return nextRetryAt; }
  public void setNextRetryAt(LocalDateTime nextRetryAt) { this.nextRetryAt = nextRetryAt; }
}
