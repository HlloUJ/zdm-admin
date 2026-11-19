package com.zdm.platform.storeexit;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Retired identifiers stay fenced even before a background worker notices a live database restore. */
@Component
@DependsOn("flywayInitializer")
public class StoreExitRecoveryState {
  private static final String OWN_OPERATIONS = "zdm.store-exit.current-operations";
  private final JdbcTemplate jdbc;
  private final StoreExitJournal journal;
  private volatile Set<Long> pending = Set.of();
  private volatile Set<Long> retired = Set.of();
  private volatile boolean unavailable;
  private boolean initialized;

  public StoreExitRecoveryState(JdbcTemplate jdbc, StoreExitJournal journal) {
    this.jdbc = jdbc; this.journal = journal; refreshSafely();
  }

  public synchronized void refresh() { refreshSafely(); }

  private void refreshSafely() {
    try { refreshVerified(); }
    catch (RuntimeException exception) {
      // A running instance keeps its already verified permanent fences. New destructive/restore
      // operations still require a fresh independent read; a cold instance fails closed.
      unavailable = !initialized;
    }
  }

  private void refreshVerified() {
    Map<String, Set<String>> stages = new HashMap<>();
    var entries = journal.entries();
    entries.forEach(e -> stages.computeIfAbsent(e.operationId(), key -> new HashSet<>()).add(e.stage()));
    Set<Long> affected = new HashSet<>();
    Set<Long> permanent = new HashSet<>(retired);
    for (var entry : entries) {
      Set<String> state = stages.get(entry.operationId());
      if (state.contains("COMMITTED")) { permanent.add(entry.storeId()); }
      if (state.contains("COMMITTED") && state.contains("ROLLED_BACK")) { affected.add(entry.storeId()); continue; }
      if (state.contains("ROLLED_BACK")) { continue; }
      if (ownsOperation(entry.operationId())) { affected.add(entry.storeId()); continue; }
      var receipts = jdbc.queryForList("SELECT operation_id FROM store_exit_operations WHERE operation_id=? AND store_id=? AND tenant_id=?",
          entry.operationId(), entry.storeId(), entry.tenantId());
      if (!state.contains("COMMITTED") && receipts.isEmpty()) { affected.add(entry.storeId()); continue; }
      if (receipts.isEmpty() || java.util.Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM stores WHERE id=?", Long.class, entry.storeId()), "数量查询缺少结果") > 0) {
        affected.add(entry.storeId());
      } else { permanent.add(entry.storeId()); }
    }
    pending = Set.copyOf(affected); retired = Set.copyOf(permanent); initialized = true; unavailable = false;
  }

  public synchronized void requireFreshAvailability(long storeId) {
    journal.requireReady(); refreshVerified(); requireAvailable(storeId);
  }

  public synchronized void begin(String operationId, long storeId) {
    fence(storeId);
    Object existing = TransactionSynchronizationManager.getResource(OWN_OPERATIONS);
    if (existing == null) {
      Set<String> operations = new HashSet<>(); operations.add(operationId);
      TransactionSynchronizationManager.bindResource(OWN_OPERATIONS, operations);
    } else if (existing instanceof Set<?> values) {
      @SuppressWarnings("unchecked") Set<String> operations = (Set<String>) values;
      operations.add(operationId);
    } else { throw new IllegalStateException("退出事务上下文不一致"); }
  }

  public synchronized void fence(long storeId) {
    Set<Long> copy = new HashSet<>(pending); copy.add(storeId); pending = Set.copyOf(copy);
  }

  public synchronized void finish(String operationId, long storeId, boolean committed) {
    fence(storeId);
    if (committed) { Set<Long> copy = new HashSet<>(retired); copy.add(storeId); retired = Set.copyOf(copy); }
    Object existing = TransactionSynchronizationManager.getResource(OWN_OPERATIONS);
    if (existing instanceof Set<?> operations) {
      operations.remove(operationId);
      if (operations.isEmpty()) { TransactionSynchronizationManager.unbindResourceIfPossible(OWN_OPERATIONS); }
    }
  }

  public static boolean ownsOperation(String operationId) {
    Object operations = TransactionSynchronizationManager.getResource(OWN_OPERATIONS);
    return operations instanceof Set<?> values && values.contains(operationId);
  }

  public void requireCatalogAvailable() {
    if (unavailable) { throw new IllegalStateException("门店退出恢复记录不可核实，门店范围暂不可读取"); }
  }
  public Set<Long> pendingStoreIds() { return Set.copyOf(pending); }
  public Set<Long> blockedStoreIds() { Set<Long> all = new HashSet<>(pending); all.addAll(retired); return Set.copyOf(all); }
  public boolean resultRequiresAttention(long storeId) { return unavailable || pending.contains(storeId); }
  public boolean retired(long storeId) { return retired.contains(storeId); }
  public boolean blocks(Long storeId) { return storeId != null && (unavailable || pending.contains(storeId) || retired.contains(storeId)); }
  public void requireAvailable(Long storeId) {
    if (blocks(storeId)) { throw new org.springframework.security.access.AccessDeniedException("门店已退出或退出结果尚待恢复核验，当前范围不可使用"); }
  }
}
