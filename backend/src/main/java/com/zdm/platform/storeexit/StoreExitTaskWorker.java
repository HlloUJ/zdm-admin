package com.zdm.platform.storeexit;

import com.zdm.platform.media.MediaCleanupService;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Component
public class StoreExitTaskWorker {
  private final JdbcTemplate jdbc;
  private final MediaCleanupService cleanup;
  private final StoreExitJournal journal;
  private final StoreExitMediaFollowup mediaFollowup;
  private final TransactionTemplate transactions;
  private final int maxAttempts;

  public StoreExitTaskWorker(JdbcTemplate jdbc, MediaCleanupService cleanup, StoreExitJournal journal,
      StoreExitMediaFollowup mediaFollowup, PlatformTransactionManager manager,
      @org.springframework.beans.factory.annotation.Value("${zdm.store-exit.max-attempts:5}") int maxAttempts) {
    this.jdbc = jdbc; this.cleanup = cleanup; this.journal = journal;
    this.mediaFollowup = mediaFollowup;
    transactions = new TransactionTemplate(manager);
    this.maxAttempts = Math.max(1, maxAttempts);
  }

  @Scheduled(fixedDelayString = "${zdm.store-exit.retry-delay-ms:60000}")
  public void run() {
    List<Long> ids = jdbc.queryForList("""
        SELECT id FROM store_exit_tasks WHERE status IN ('pending','failed')
        AND attempts<? AND next_attempt_at<=CURRENT_TIMESTAMP(6) ORDER BY id LIMIT 100
        """, Long.class, maxAttempts);
    for (Long id : ids) {
      try {
        transactions.executeWithoutResult(status -> {
          var rows = jdbc.queryForList("SELECT * FROM store_exit_tasks WHERE id=? AND status<>'complete' FOR UPDATE", id);
          if (rows.isEmpty()) { return; }
          long mediaId = ((Number) rows.getFirst().get("media_id")).longValue();
          if (mediaId == 0) {
            String operationId = (String) rows.getFirst().get("operation_id");
            var operation = jdbc.queryForMap("SELECT * FROM store_exit_operations WHERE operation_id=?", operationId);
            journal.committed(operation);
          } else {
            cleanup.enqueue(mediaId, "realtime", "门店退出引用释放后交由媒体生命周期处理", false);
          }
          jdbc.update("UPDATE store_exit_tasks SET status='complete',last_error_code=NULL WHERE id=?", id);
        });
      } catch (RuntimeException exception) {
        jdbc.update("""
            UPDATE store_exit_tasks SET status=IF(attempts+1>=?,'blocked','failed'),attempts=attempts+1,
            last_error_code='EXIT_HANDOFF_FAILED',next_attempt_at=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 MINUTE)
            WHERE id=? AND status<>'complete'
            """, maxAttempts, id);
      }
    }
    for (var operation : jdbc.queryForList("SELECT operation_id,store_id,tenant_id FROM store_exit_operations WHERE status='DB_COMMITTED'")) {
      String id = (String) operation.get("operation_id");
      long store = ((Number) operation.get("store_id")).longValue();
      if (mediaFollowup.inspect(id).pending() > 0) { continue; }
      jdbc.update("""
            UPDATE store_exit_operations SET status='COMPLETE' WHERE operation_id=?
            AND NOT EXISTS(SELECT 1 FROM store_exit_tasks WHERE operation_id=? AND status<>'complete')
            AND NOT EXISTS(SELECT 1 FROM stores WHERE id=?)
            """, id, id, store);
    }
  }
}
