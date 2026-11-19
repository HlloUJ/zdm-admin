package com.zdm.platform.storeexit;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Native AUTO_INCREMENT is preserved; only identifiers reserved by independent exit history are skipped. */
@Component
public class HistoricIdentifierGuard {
  private final JdbcTemplate jdbc;
  private final StoreExitJournal journal;
  private final ObjectMapper json;
  public HistoricIdentifierGuard(JdbcTemplate jdbc, StoreExitJournal journal, ObjectMapper json) {
    this.jdbc = jdbc; this.journal = journal; this.json = json;
  }

  public long reserve(String table) {
    if (!java.util.Set.of("stores", "accounts").contains(table)) { throw new IllegalArgumentException("标识类型错误"); }
    long maximum = 0;
    for (var entry : journal.entries()) {
      if ("stores".equals(table)) { maximum = Math.max(maximum, entry.storeId()); }
      else {
        Object ids = entry.receipt().get("accountIds");
        if (ids == null && entry.receipt().get("result_json") != null) {
          try { ids = json.readTree(String.valueOf(entry.receipt().get("result_json"))).path("accountIds"); }
          catch (com.fasterxml.jackson.core.JsonProcessingException exception) { throw new IllegalStateException("历史账号标识不可核实", exception); }
        }
        if (ids != null) {
          java.util.List<Long> historic = json.convertValue(ids, new com.fasterxml.jackson.core.type.TypeReference<java.util.List<Long>>() { });
          if (historic == null) { throw new IllegalStateException("历史账号标识集合缺失，不能分配新标识"); }
          for (Long id : historic) {
            maximum = Math.max(maximum, id);
          }
        }
      }
    }
    if (maximum == 0) { return 0; }
    if (!TransactionSynchronizationManager.isActualTransactionActive()) { throw new IllegalStateException("标识分配需要业务事务"); }
    String key = "zdm-id:" + StoreExitCoverage.hash(jdbc.queryForObject("SELECT DATABASE()", String.class) + ":" + table).substring(0,40);
    if (!TransactionSynchronizationManager.hasResource(key)) {
      Integer locked = jdbc.queryForObject("SELECT GET_LOCK(?,5)", Integer.class, key);
      if (locked == null || locked != 1) { throw new IllegalStateException("标识分配繁忙，请稍后重试"); }
      TransactionSynchronizationManager.bindResource(key, Boolean.TRUE);
      TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override public void afterCompletion(int status) {
          try { jdbc.queryForObject("SELECT RELEASE_LOCK(?)", Integer.class, key); }
          finally { TransactionSynchronizationManager.unbindResourceIfPossible(key); }
        }
      });
    }
    return maximum;
  }

  public record AccountExitState(boolean retired, java.util.Set<Long> uncertainStores) {
    public AccountExitState { uncertainStores = java.util.Set.copyOf(uncertainStores); }
  }

  public AccountExitState accountExitState(long accountId) {
    var entries = journal.entries();
    var finalStages = new java.util.HashMap<String, java.util.Set<String>>();
    entries.forEach(entry -> finalStages.computeIfAbsent(entry.operationId(), key -> new java.util.HashSet<>()).add(entry.stage()));
    java.util.Set<Long> uncertain = new java.util.HashSet<>();
    boolean retired = false;
    for (var entry : entries) {
      try {
        var stages = finalStages.get(entry.operationId());
        if ("COMMITTED".equals(entry.stage())) {
          var ids = json.readTree(String.valueOf(entry.receipt().get("result_json"))).path("accountIds");
          for (var id : ids) { retired |= id.asLong() == accountId; }
        } else if ("INTENT".equals(entry.stage()) && !stages.contains("COMMITTED") && !stages.contains("ROLLED_BACK")) {
          var ids = json.valueToTree(entry.receipt().get("accountIds"));
          for (var id : ids) { if (id.asLong() == accountId) { uncertain.add(entry.storeId()); } }
        }
      } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
        throw new IllegalStateException("历史账号退出结果不可核实", exception);
      }
    }
    return new AccountExitState(retired, java.util.Set.copyOf(uncertain));
  }

  public long skipReserved(String table, long generated, long watermark) {
    if (!java.util.Set.of("stores", "accounts").contains(table)) { throw new IllegalArgumentException("标识类型错误"); }
    if (generated > watermark) { return generated; }
    long replacement = Math.addExact(watermark, 1);
    if (jdbc.update("UPDATE " + table + " SET id=? WHERE id=?", replacement, generated) != 1) {
      throw new IllegalStateException("新主体标识分配失败");
    }
    return replacement;
  }
}
