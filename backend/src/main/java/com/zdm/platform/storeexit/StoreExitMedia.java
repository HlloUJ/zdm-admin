package com.zdm.platform.storeexit;

import com.zdm.platform.media.MediaRetentionService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class StoreExitMedia {
  private static final Map<String, String> DOMAINS = StoreExitMediaDomains.PARENTS.entrySet().stream()
      .collect(java.util.stream.Collectors.toUnmodifiableMap(Map.Entry::getValue, Map.Entry::getKey));
  private final JdbcTemplate jdbc;
  private final MediaRetentionService retention;
  public StoreExitMedia(JdbcTemplate jdbc, MediaRetentionService retention) {
    this.jdbc = jdbc; this.retention = retention;
  }

  public List<Long> mediaIds(StoreExitScope scope) {
    List<Long> result = new ArrayList<>();
    DOMAINS.forEach((table, domain) -> scope.ids(table).forEach(id -> result.addAll(jdbc.queryForList(
        "SELECT media_id FROM media_references WHERE business_domain=? AND business_id=?", Long.class, domain, id))));
    // Uploaded assets are not assumed exclusive; only ask the normal lifecycle to reevaluate them.
    result.addAll(jdbc.queryForList("SELECT id FROM media_assets WHERE store_id=?", Long.class, scope.storeId()));
    return result.stream().distinct().sorted().toList();
  }

  public void release(StoreExitScope scope, String operationId, List<Long> mediaIds) {
    DOMAINS.forEach((table, domain) -> scope.ids(table).forEach(id -> jdbc.update(
        "DELETE FROM media_references WHERE business_domain=? AND business_id=?", domain, id)));
    for (Long mediaId : mediaIds) {
      retention.released(mediaId);
      jdbc.update("INSERT IGNORE INTO store_exit_tasks(operation_id,media_id) VALUES (?,?)", operationId, mediaId);
    }
  }

  public void verify(StoreExitScope scope) {
    DOMAINS.forEach((table, domain) -> scope.ids(table).forEach(id -> {
      Long count = jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE business_domain=? AND business_id=?",
          Long.class, domain, id);
      if (count != null && count > 0) { throw new IllegalStateException("门店媒体引用残留"); }
    }));
  }

  public Map<String, String> releaseCheckpoints(List<Long> mediaIds) {
    Map<String, String> result = new java.util.LinkedHashMap<>();
    for (Long id : mediaIds) {
      var rows = jdbc.queryForList("SELECT unreferenced_since FROM media_assets WHERE id=?", id);
      if (!rows.isEmpty()) {
        Object released = rows.getFirst().get("unreferenced_since");
        result.put(id.toString(), released == null ? "REFERENCED" : released.toString());
      }
    }
    return result;
  }

  public void restoreCheckpoints(String operation, List<Long> mediaIds, com.fasterxml.jackson.databind.JsonNode checkpoints) {
    for (Long id : mediaIds) {
      String released = checkpoints.path(id.toString()).asText("");
      if (!released.isBlank() && !"REFERENCED".equals(released)) {
        jdbc.update("""
            UPDATE media_assets a SET unreferenced_since=? WHERE id=? AND NOT EXISTS (
              SELECT 1 FROM media_references r WHERE r.media_id=a.id AND r.reference_kind IN ('BUSINESS','PREVIEW'))
            """, released, id);
        jdbc.update("""
            UPDATE store_exit_tasks SET status='pending',next_attempt_at=CURRENT_TIMESTAMP(6),attempts=0
            WHERE operation_id=? AND media_id=? AND status='complete'
            """, operation, id);
      } else if (retention.count(id, "BUSINESS") + retention.count(id, "PREVIEW") == 0) {
        jdbc.update("""
            UPDATE store_exit_tasks SET status='blocked',last_error_code='RESTORE_RELEASE_TIME_UNCERTAIN'
            WHERE operation_id=? AND media_id=?
            """, operation, id);
      }
    }
  }
}
