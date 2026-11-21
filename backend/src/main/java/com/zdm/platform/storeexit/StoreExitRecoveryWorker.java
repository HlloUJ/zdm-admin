package com.zdm.platform.storeexit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class StoreExitRecoveryWorker {
  private static final Logger LOG = LoggerFactory.getLogger(StoreExitRecoveryWorker.class);
  private final StoreExitJournal journal;
  private final StoreExitCoordinator coordinator;
  private final StoreExitRecoveryState state;
  private final JdbcTemplate jdbc;

  public StoreExitRecoveryWorker(StoreExitJournal journal, StoreExitCoordinator coordinator,
      StoreExitRecoveryState state, JdbcTemplate jdbc) {
    this.journal = journal; this.coordinator = coordinator; this.state = state; this.jdbc = jdbc;
  }

  @EventListener(ApplicationReadyEvent.class)
  public void startup() { run(); }

  @Scheduled(fixedDelayString = "${zdm.store-exit.recovery-delay-ms:60000}", initialDelayString = "${zdm.store-exit.recovery-initial-delay-ms:60000}")
  public void run() {
    try {
      state.refresh();
      var entries = journal.entries();
      var conflicted = entries.stream().filter(e -> "ROLLED_BACK".equals(e.stage()))
          .map(StoreExitJournal.Entry::operationId).collect(java.util.stream.Collectors.toSet());
      for (var entry : entries) {
        if (conflicted.contains(entry.operationId())) { continue; }
        if ("INTENT".equals(entry.stage())) {
          var receipts = jdbc.queryForList("SELECT * FROM store_exit_operations WHERE operation_id=? AND store_id=? AND tenant_id=?",
              entry.operationId(), entry.storeId(), entry.tenantId());
          if (!receipts.isEmpty()) { journal.committed(receipts.getFirst()); }
        }
      }
      for (var entry : journal.entries()) {
        if ("COMMITTED".equals(entry.stage()) && !conflicted.contains(entry.operationId()) && state.pendingStoreIds().contains(entry.storeId())) {
          Long failures = jdbc.queryForObject("""
              SELECT COUNT(*) FROM store_exit_events e WHERE e.operation_id=? AND e.reason_code='RECOVERY_FAILED'
              AND e.id>COALESCE((SELECT MAX(m.id) FROM store_exit_events m WHERE m.operation_id=? AND m.reason_code='MANUAL_RETRY'),0)
              """, Long.class, entry.operationId(), entry.operationId());
          if (failures != null && failures >= 5) { continue; }
          try { coordinator.reapplyAfterRestore(entry); }
          catch (RuntimeException exception) {
            jdbc.update("""
                INSERT INTO store_exit_events(operation_id,store_id,tenant_id,result,reason_code)
                VALUES (?,?,?,'BLOCKED','RECOVERY_FAILED')
                """, entry.operationId(), entry.storeId(), entry.tenantId());
            LOG.error("Store restoration cleanup blocked: {}", entry.operationId(), exception);
          }
        }
      }
      state.refresh();
    } catch (RuntimeException exception) {
      LOG.error("Store exit restoration requires attention; affected stores remain fenced", exception);
    }
  }
}
