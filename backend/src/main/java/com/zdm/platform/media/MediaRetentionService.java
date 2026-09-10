package com.zdm.platform.media;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class MediaRetentionService {
  private final JdbcTemplate jdbc;
  private final MediaStorageService storage;
  public MediaRetentionService(JdbcTemplate jdbc, MediaStorageService storage) { this.jdbc = jdbc; this.storage = storage; }

  public MediaRetentionPolicy.Decision evaluate(MediaAsset asset) {
    if (count(asset.getId(), "HISTORY") > 0 && "ready".equals(asset.getHistoryPreviewState())) {
      var previews = jdbc.queryForList("SELECT storage_key FROM media_assets WHERE id=? AND status<>'deleted'", String.class, asset.getHistoryPreviewMediaId());
      if (previews.isEmpty() || !storage.load(previews.getFirst()).exists()) {
        return new MediaRetentionPolicy.Decision(false, null, "历史预览文件缺失，原文件继续保护");
      }
    }
    return MediaRetentionPolicy.evaluate(asset, count(asset.getId(), "BUSINESS") + count(asset.getId(), "PREVIEW"),
        count(asset.getId(), "HISTORY"), count(asset.getId(), "MANUAL"), LocalDateTime.now());
  }

  public long count(Long id, String kind) {
    Long count = jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE media_id = ? AND reference_kind = ?",
        Long.class, id, kind);
    return count == null ? 0 : count;
  }

  public void released(Long id) {
    jdbc.update("""
        UPDATE media_assets a SET unreferenced_since = COALESCE(unreferenced_since, CURRENT_TIMESTAMP)
        WHERE id = ? AND NOT EXISTS (SELECT 1 FROM media_references r
          WHERE r.media_id = a.id AND r.reference_kind IN ('BUSINESS', 'PREVIEW'))
        """, id);
  }

  public boolean deletionEnabled() {
    return Boolean.TRUE.equals(jdbc.queryForObject(
        "SELECT deletion_enabled AND migration_completed FROM media_lifecycle_control WHERE id = 1", Boolean.class));
  }

  public List<Map<String, Object>> inventory() {
    return jdbc.queryForList("""
        SELECT a.id, a.original_name, a.media_type, a.status, a.unreferenced_since,
          a.history_preview_state, a.history_preview_error,
          (SELECT COUNT(*) FROM media_references r WHERE r.media_id=a.id AND r.reference_kind='BUSINESS') AS business_references,
          (SELECT COUNT(*) FROM media_references r WHERE r.media_id=a.id AND r.reference_kind='HISTORY') AS history_references,
          (SELECT COUNT(*) FROM media_references r WHERE r.media_id=a.id AND r.reference_kind='MANUAL') AS manual_references
        FROM media_assets a ORDER BY a.id
        """);
  }
}
