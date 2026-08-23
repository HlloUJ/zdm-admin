package com.zdm.platform.media;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import java.time.LocalDateTime;

@TableName("media_cleanup_runs")
public class MediaCleanupRun extends BaseEntity {
  private String triggerType;
  private Integer scannedCount;
  private Integer deletedCount;
  private Integer failedCount;
  private Long releasedBytes;
  private LocalDateTime startedAt;
  private LocalDateTime finishedAt;

  public String getTriggerType() { return triggerType; }
  public void setTriggerType(String triggerType) { this.triggerType = triggerType; }
  public Integer getScannedCount() { return scannedCount; }
  public void setScannedCount(Integer scannedCount) { this.scannedCount = scannedCount; }
  public Integer getDeletedCount() { return deletedCount; }
  public void setDeletedCount(Integer deletedCount) { this.deletedCount = deletedCount; }
  public Integer getFailedCount() { return failedCount; }
  public void setFailedCount(Integer failedCount) { this.failedCount = failedCount; }
  public Long getReleasedBytes() { return releasedBytes; }
  public void setReleasedBytes(Long releasedBytes) { this.releasedBytes = releasedBytes; }
  public LocalDateTime getStartedAt() { return startedAt; }
  public void setStartedAt(LocalDateTime startedAt) { this.startedAt = startedAt; }
  public LocalDateTime getFinishedAt() { return finishedAt; }
  public void setFinishedAt(LocalDateTime finishedAt) { this.finishedAt = finishedAt; }
}
