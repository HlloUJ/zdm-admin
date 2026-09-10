package com.zdm.platform.media;

import java.time.LocalDateTime;

/** Shared eligibility calculation for realtime, scheduled and retried cleanup. */
public final class MediaRetentionPolicy {
  public static final int HISTORY_DAYS = 180;
  public static final int BUFFER_HOURS = 24;
  private MediaRetentionPolicy() {}

  public static Decision evaluate(MediaAsset asset, long business, long history, long manual, LocalDateTime now) {
    if ("deleted".equals(asset.getStatus())) {
      return new Decision(false, null, "已删除");
    }
    if (business > 0) {
      return new Decision(false, null, "业务正在使用");
    }
    if (manual > 0) {
      return new Decision(false, null, "人工保留");
    }
    LocalDateTime released = asset.getUnreferencedSince();
    if (history > 0) {
      if (released == null) {
        return new Decision(false, null, "等待确认引用解除时间");
      }
      if (!"ready".equals(asset.getHistoryPreviewState())) {
        return new Decision(false, null, "历史预览尚未就绪");
      }
      LocalDateTime deadline = released.plusDays(HISTORY_DAYS).plusHours(BUFFER_HOURS);
      return new Decision(!now.isBefore(deadline), deadline, "历史原文件保留180天及24小时缓冲");
    }
    LocalDateTime start = released != null ? released : asset.getCreatedAt();
    if (start == null) {
      return new Decision(false, null, "文件登记时间待核查");
    }
    LocalDateTime deadline = start.plusHours(BUFFER_HOURS);
    return new Decision(!now.isBefore(deadline), deadline, "无引用文件24小时缓冲");
  }

  public record Decision(boolean eligible, LocalDateTime deleteAfter, String reason) {}
}
