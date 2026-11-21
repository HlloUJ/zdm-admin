package com.zdm.platform.storeexit;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** A successful handoff is not proof that the downstream media job has finished. */
@Component
public class StoreExitMediaFollowup {
  private final JdbcTemplate jdbc;
  public StoreExitMediaFollowup(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  public record State(long pending, long failed) { }

  public State inspect(String operation) {
    return jdbc.queryForObject("""
        SELECT COUNT(*) AS pending, COALESCE(SUM(EXISTS(
          SELECT 1 FROM media_cleanup_tasks failure WHERE failure.media_id=t.media_id AND failure.status='failed')),0) AS failed
        FROM store_exit_tasks t
        WHERE t.operation_id=? AND t.media_id>0 AND t.status='complete'
          AND EXISTS(SELECT 1 FROM media_cleanup_tasks m WHERE m.media_id=t.media_id
            AND m.status IN ('pending','processing','failed'))
        """, (rs, row) -> new State(rs.getLong("pending"), rs.getLong("failed")), operation);
  }
}
