package com.zdm.platform.storeexit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.account.AccountLifecycleService;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.DataScope;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class StoreExitCoordinator {
  public static final String RULE_VERSION = "V1.3";
  private static final Logger LOG = LoggerFactory.getLogger(StoreExitCoordinator.class);
  private final JdbcTemplate jdbc;
  private final StoreExitRegistry registry;
  private final StoreExitCoverage coverage;
  private final StoreExitJournal journal;
  private final StoreExitMedia media;
  private final AccountLifecycleService accounts;
  private final CurrentIdentityProvider identities;
  private final ObjectMapper json;
  private final TransactionTemplate auditTransaction;
  private final StoreExitRecoveryState recovery;
  private final StoreExitMediaFollowup mediaFollowup;
  private final com.zdm.platform.security.SecurityAuditService securityAudit;

  public StoreExitCoordinator(JdbcTemplate jdbc, StoreExitRegistry registry, StoreExitCoverage coverage,
      StoreExitJournal journal, StoreExitMedia media, AccountLifecycleService accounts,
      CurrentIdentityProvider identities, ObjectMapper json, PlatformTransactionManager transactions,
      StoreExitRecoveryState recovery, StoreExitMediaFollowup mediaFollowup,
      com.zdm.platform.security.SecurityAuditService securityAudit) {
    this.jdbc = jdbc; this.registry = registry; this.coverage = coverage; this.journal = journal;
    this.media = media; this.accounts = accounts; this.identities = identities; this.json = json;
    this.recovery = recovery;
    this.mediaFollowup = mediaFollowup; this.securityAudit = securityAudit;
    auditTransaction = new TransactionTemplate(transactions);
    auditTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  public StoreExitPreview preview(long storeId) { return preview(storeId, false); }

  public StoreExitPreview previewForTenant(long storeId) { return preview(storeId, true); }

  private StoreExitPreview preview(long storeId, boolean tenantExit) {
    Map<String, Object> store = target(storeId, false);
    authorize(store, tenantExit);
    recovery.refresh();
    recovery.requireAvailable(storeId);
    long tenantId = number(store.get("tenant_id"));
    StoreExitScope scope = StoreExitScope.capture(jdbc, storeId, tenantId);
    List<String> blockers = new ArrayList<>();
    if (!"disabled".equals(store.get("status"))) { blockers.add("请先归档门店"); }
    String schema = "";
    try { schema = coverage.verify(); } catch (IllegalStateException e) { blockers.add(e.getMessage()); }
    try { journal.requireReady(); } catch (IllegalStateException e) { blockers.add(e.getMessage()); }
    if (foreignReferences(scope)) { blockers.add("该门店仍有跨组织引用，不能彻底删除"); }
    if (!securityAudit.storeHistoryVerifiable(scope.ids("account_identities"))) {
      blockers.add("门店历史安全审计的身份归属无法核实");
    }
    Map<String, Long> counts = new LinkedHashMap<>();
    registry.modules().forEach(module -> counts.putAll(inspectModule(module, scope)));
    counts.put("media_lifecycle_candidates", (long) media.mediaIds(scope).size());
    java.util.Set<Long> removedStores = tenantExit ? new java.util.HashSet<>(jdbc.queryForList(
        "SELECT id FROM stores WHERE tenant_id=?", Long.class, tenantId)) : java.util.Set.of(storeId);
    var relationshipAccounts = accounts.storeExitRelationshipCandidates(storeId);
    var candidateAccounts = accounts.storeExitCandidates(scope);
    Map<Long, String> accountDecisions = new java.util.TreeMap<>();
    long deletedAccounts = 0; long releasedPhones = 0; long retainedAccounts = 0;
    for (Long account : candidateAccounts) {
      var disposition = tenantExit ? accounts.assessForTenantExit(account, removedStores, tenantId)
          : accounts.assessForExit(account, removedStores, null);
      boolean releasePhone = disposition == AccountLifecycleService.Disposition.DELETE && accounts.hasPhoneCredential(account);
      accountDecisions.put(account, disposition.name() + ":" + releasePhone);
      if (disposition == AccountLifecycleService.Disposition.DELETE) { deletedAccounts++; }
      if (releasePhone) { releasedPhones++; }
      if (disposition != AccountLifecycleService.Disposition.DELETE && relationshipAccounts.contains(account)) { retainedAccounts++; }
    }
    counts.put("accounts_delete", deletedAccounts);
    counts.put("accounts_retained", retainedAccounts);
    counts.put("phones_released", releasedPhones);
    List<String> retained = List.of("共享商品、SKU、库存及其他组织数据保留",
        "平台安全审计、最小退出凭证及必要任务按规则保留", "媒体按有效引用和既有生命周期处理；不清理备份或承诺擦除离线副本");
    String hash = StoreExitCoverage.hash(RULE_VERSION + schema + encode(new java.util.TreeMap<>(counts))
        + scope.storeId() + "/" + scope.tenantId() + encode(new java.util.TreeMap<>(scope.parentIds()))
        + encode(media.mediaIds(scope)) + encode(accountDecisions) + String.valueOf(store.get("name")));
    return new StoreExitPreview(storeId, tenantId, String.valueOf(store.get("name")), RULE_VERSION, hash, counts, retained, blockers);
  }

  /** Called only from a transaction holding the tenant lock before all store locks. */
  public void lockTenantStores(long tenantId) {
    jdbc.queryForList("SELECT id FROM stores WHERE tenant_id=? ORDER BY id FOR UPDATE", Long.class, tenantId);
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public List<Long> execute(long storeId, String confirmedHash, boolean tenantExit) {
    Map<String, Object> store = target(storeId, true);
    authorize(store, tenantExit);
    StoreExitPreview preview = preview(storeId, tenantExit);
    if (!preview.eligible()) { throw new IllegalArgumentException(preview.blockers().getFirst()); }
    if (confirmedHash == null || !confirmedHash.equals(preview.planHash())) {
      throw new IllegalArgumentException("删除范围或规则已变化，请重新预检并确认");
    }
    StoreExitScope scope = StoreExitScope.capture(jdbc, storeId, preview.tenantId());
    List<Long> accountIds = accounts.storeExitCandidates(scope);
    if (tenantExit) {
      java.util.Set<Long> all = new java.util.TreeSet<>(accountIds);
      all.addAll(jdbc.queryForList("""
          SELECT account_id FROM account_identities WHERE tenant_id=?
          UNION SELECT account_id FROM employees WHERE tenant_id=? AND account_id IS NOT NULL
          UNION SELECT account_id FROM account_roles WHERE tenant_id=?
          UNION SELECT account_id FROM tenants WHERE id=? ORDER BY account_id
          """, Long.class, scope.tenantId(), scope.tenantId(), scope.tenantId(), scope.tenantId()));
      for (Long id : jdbc.queryForList("SELECT id FROM stores WHERE tenant_id=? ORDER BY id", Long.class, scope.tenantId())) {
        all.addAll(accounts.storeExitCandidates(StoreExitScope.capture(jdbc, id, scope.tenantId())));
      }
      accountIds = List.copyOf(all);
    }
    accountIds.forEach(accounts::lockAccount);
    String operation = UUID.randomUUID().toString();
    CurrentIdentity actor = identities.require();
    try { journal.intent(operation, storeId, scope.tenantId(), accountIds, actor); }
    catch (RuntimeException exception) {
      recovery.fence(storeId);
      try { journal.append(operation, storeId, scope.tenantId(), "ROLLED_BACK"); }
      catch (RuntimeException pending) { LOG.error("Store exit acceptance outcome unresolved: {}", operation, pending); }
      recovery.refresh(); throw exception;
    }
    recovery.begin(operation, storeId);
    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
      @Override public void afterCompletion(int status) {
        recovery.finish(operation, storeId, status == STATUS_COMMITTED);
        String outcome = status == STATUS_COMMITTED ? "COMMITTED" : status == STATUS_ROLLED_BACK ? "ROLLED_BACK" : "UNKNOWN";
        if (!"UNKNOWN".equals(outcome)) {
          try {
            if ("COMMITTED".equals(outcome)) {
              journal.committed(jdbc.queryForMap("SELECT * FROM store_exit_operations WHERE operation_id=?", operation));
            } else { journal.append(operation, storeId, scope.tenantId(), outcome); }
          }
          catch (RuntimeException exception) { LOG.error("Store exit journal outcome pending: {}", operation, exception); }
        }
        if (status != STATUS_COMMITTED) {
          auditFailure(operation, storeId, scope.tenantId(), actor.accountId(), outcome);
        }
        recovery.refresh();
      }
    });
    List<Long> mediaIds = media.mediaIds(scope);
    jdbc.update("INSERT INTO store_exit_tasks(operation_id,media_id) VALUES (?,0)", operation);
    String tenantName = jdbc.queryForObject("SELECT a.display_name FROM tenants t JOIN accounts a ON a.id=t.account_id WHERE t.id=?", String.class, scope.tenantId());
    media.release(scope, operation, mediaIds);
    securityAudit.preserveStoreHistory(scope.storeId(), scope.tenantId(), scope.ids("account_identities"), preview.storeName(), tenantName, null);
    for (StoreExitModule module : registry.modules()) { module.execute(jdbc, scope); }
    jdbc.update("DELETE FROM stores WHERE id=? AND tenant_id=? AND status='disabled'", storeId, scope.tenantId());
    for (StoreExitModule module : registry.modules()) {
      module.verify(jdbc, scope);
      if (inspectModule(module, scope).values().stream().anyMatch(count -> count > 0)) {
        throw new IllegalStateException("门店退出模块仍有应删数据：" + module.id());
      }
    }
    media.verify(scope);
    if (java.util.Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM stores WHERE id=?", Long.class, storeId), "数量查询缺少结果") != 0) {
      throw new IllegalStateException("门店主档残留校验失败");
    }
    jdbc.update("""
        INSERT INTO store_exit_operations
          (operation_id,store_id,tenant_id,store_name,tenant_name,store_created_by_account_id,operator_account_id,operator_name,
           operator_identity,rule_version,plan_hash,status,result_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CAST(? AS JSON))
        """, operation, storeId, scope.tenantId(), preview.storeName(), tenantName, store.get("created_by_account_id"), actor.accountId(), actor.displayName(),
        actor.clientCode() + ":" + actor.identityId(), RULE_VERSION, confirmedHash, "DB_COMMITTED",
        encode(Map.of("counts", preview.counts(), "retained", preview.retained(), "verified", true,
            "mediaRelease", media.releaseCheckpoints(mediaIds), "accountIds", accountIds.stream().map(String::valueOf).toList())));
    return accountIds;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void recordAccountOutcome(long storeId, List<Long> candidates) {
    List<String> deleted = candidates.stream().filter(account -> java.util.Objects.requireNonNull(jdbc.queryForObject(
        "SELECT COUNT(*) FROM accounts WHERE id=?", Long.class, account), "数量查询缺少结果") == 0).map(String::valueOf).toList();
    Map<String, String> snapshots = new java.util.TreeMap<>();
    for (String account : deleted) {
      jdbc.query("SELECT display_name_at_exit FROM store_exit_actor_snapshots WHERE account_id=?",
          (org.springframework.jdbc.core.RowCallbackHandler) row -> snapshots.put(account, row.getString(1)), Long.parseLong(account));
    }
    jdbc.update("UPDATE store_exit_operations SET result_json=JSON_SET(result_json,'$.accountIds',CAST(? AS JSON),'$.actorSnapshots',CAST(? AS JSON)) WHERE store_id=?",
        encode(deleted), encode(snapshots), storeId);
  }

  public void requireTenantLock(long tenantId) {
    if (jdbc.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE", Long.class, tenantId).isEmpty()) {
      throw new IllegalArgumentException("租户不存在");
    }
  }

  /** Only a durable, independently stored COMMITTED receipt may authorize restoration cleanup. */
  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public void reapplyAfterRestore(StoreExitJournal.Entry entry) {
    if (!"COMMITTED".equals(entry.stage()) || !journal.entries().contains(entry)) {
      throw new IllegalArgumentException("恢复清理缺少可信成功凭证");
    }
    coverage.verify();
    jdbc.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE", Long.class, entry.tenantId());
    var restored = jdbc.queryForList("SELECT tenant_id FROM stores WHERE id=? FOR UPDATE", entry.storeId());
    if (!restored.isEmpty() && number(restored.getFirst().get("tenant_id")) != entry.tenantId()) {
      throw new IllegalStateException("恢复对象归属与独立凭证不一致");
    }
    StoreExitScope scope = StoreExitScope.capture(jdbc, entry.storeId(), entry.tenantId());
    if (foreignReferences(scope)) { throw new IllegalStateException("恢复清理存在未解决外部引用"); }
    java.util.Set<Long> recoveryAccounts = new java.util.TreeSet<>(accounts.storeExitCandidates(scope));
    try {
      var receipt = json.readTree(String.valueOf(entry.receipt().get("result_json")));
      for (var id : receipt.path("accountIds")) {
        long account = Long.parseLong(id.asText());
        if (!jdbc.queryForList("SELECT id FROM accounts WHERE id=?", Long.class, account).isEmpty()) { recoveryAccounts.add(account); }
      }
    } catch (JsonProcessingException | NumberFormatException exception) {
      throw new IllegalStateException("退出账号恢复凭证不可核实", exception);
    }
    List<Long> accountIds = List.copyOf(recoveryAccounts);
    accountIds.forEach(accounts::lockAccount);
    List<Long> mediaIds = media.mediaIds(scope);
    media.release(scope, entry.operationId(), mediaIds);
    securityAudit.preserveStoreHistory(scope.storeId(), scope.tenantId(), scope.ids("account_identities"),
        String.valueOf(entry.receipt().get("store_name")), String.valueOf(entry.receipt().get("tenant_name")), String.valueOf(entry.receipt().get("created_at")));
    try {
      media.restoreCheckpoints(entry.operationId(), mediaIds,
          json.readTree(String.valueOf(entry.receipt().get("result_json"))).path("mediaRelease"));
    } catch (JsonProcessingException exception) { throw new IllegalStateException("独立凭证媒体起算记录损坏", exception); }
    for (StoreExitModule module : registry.modules()) { module.execute(jdbc, scope); }
    jdbc.update("DELETE FROM stores WHERE id=? AND tenant_id=?", entry.storeId(), entry.tenantId());
    for (StoreExitModule module : registry.modules()) {
      module.verify(jdbc, scope);
      if (inspectModule(module, scope).values().stream().anyMatch(count -> count > 0)) {
        throw new IllegalStateException("门店退出模块仍有应删数据：" + module.id());
      }
    }
    media.verify(scope);
    var receipt = entry.receipt();
    jdbc.update("""
        INSERT INTO store_exit_operations
          (operation_id,store_id,tenant_id,store_name,tenant_name,store_created_by_account_id,operator_account_id,operator_name,
           operator_identity,rule_version,plan_hash,status,result_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'DB_COMMITTED',CAST(? AS JSON),?)
        ON DUPLICATE KEY UPDATE status='DB_COMMITTED'
        """, entry.operationId(), entry.storeId(), entry.tenantId(), receipt.get("store_name"), receipt.get("tenant_name"),
        receipt.get("store_created_by_account_id"), receipt.get("operator_account_id"), receipt.get("operator_name"), receipt.get("operator_identity"),
        receipt.get("rule_version"), receipt.get("plan_hash"), receipt.get("result_json"), receipt.get("created_at"));
    restoreActorSnapshots(entry);
    accountIds.forEach(accounts::releaseForStoreExit);
  }

  private void restoreActorSnapshots(StoreExitJournal.Entry entry) {
    try {
      var result = json.readTree(String.valueOf(entry.receipt().get("result_json")));
      java.util.Set<Long> deleted = new java.util.HashSet<>();
      result.path("accountIds").forEach(id -> deleted.add(Long.parseLong(id.asText())));
      var snapshots = result.path("actorSnapshots");
      if (snapshots.isMissingNode()) {
        for (Long id : deleted) {
          if (accounts.requiresHistoricalName(id)) { throw new IllegalStateException("旧凭证缺少必要历史名称，不能猜测恢复"); }
        }
        return;
      }
      if (!snapshots.isObject()) { throw new IllegalStateException("退出名称快照不可核实"); }
      for (Long id : deleted) {
        if (accounts.requiresHistoricalName(id) && !snapshots.has(id.toString())) {
          throw new IllegalStateException("退出凭证遗漏必要历史名称，不能猜测恢复");
        }
      }
      var fields = snapshots.fields();
      while (fields.hasNext()) {
        var field = fields.next(); long id = Long.parseLong(field.getKey());
        if (!deleted.contains(id) || !field.getValue().isTextual() || field.getValue().asText().length() > 200) {
          throw new IllegalStateException("退出名称快照超出可信账号范围");
        }
        jdbc.update("INSERT INTO store_exit_actor_snapshots(account_id,display_name_at_exit) VALUES (?,?) ON DUPLICATE KEY UPDATE display_name_at_exit=VALUES(display_name_at_exit)", id, field.getValue().asText());
      }
    } catch (JsonProcessingException | NumberFormatException exception) { throw new IllegalStateException("退出名称凭证损坏", exception); }
  }

  public StoreExitResult result(long storeId) { return result(storeId, null); }

  /** Aggregate only the stores just deleted inside the already-authorized tenant transaction. */
  @Transactional(propagation = Propagation.MANDATORY)
  public StoreExitResult resultForTenant(long storeId, long tenantId) { return result(storeId, tenantId); }

  private StoreExitResult result(long storeId, Long authorizedTenant) {
    var rows = jdbc.queryForList("SELECT * FROM store_exit_operations WHERE store_id=?", storeId);
    if (rows.isEmpty() || java.util.Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM stores WHERE id=?", Long.class, storeId), "数量查询缺少结果") > 0) {
      throw new IllegalArgumentException("没有可证明完成主数据清理的退出结果");
    }
    var row = rows.getFirst();
    if (authorizedTenant == null) {
      DataScope.requireAccess(identities.require(), row.get("store_created_by_account_id") == null
          ? null : number(row.get("store_created_by_account_id")));
    } else if (number(row.get("tenant_id")) != authorizedTenant
        || !java.util.Objects.equals(identities.require().accountId(), row.get("operator_account_id"))) {
      throw new org.springframework.security.access.AccessDeniedException("退出结果不属于本次租户操作");
    }
    boolean recoveryAttention = !StoreExitRecoveryState.ownsOperation(String.valueOf(row.get("operation_id")))
        && recovery.resultRequiresAttention(storeId);
    long pending = java.util.Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM store_exit_tasks WHERE operation_id=? AND status<>'complete'",
        Long.class, row.get("operation_id")), "数量查询缺少结果");
    long blocked = java.util.Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM store_exit_tasks WHERE operation_id=? AND status='blocked'",
        Long.class, row.get("operation_id")), "数量查询缺少结果");
    StoreExitMediaFollowup.State mediaState = mediaFollowup.inspect(String.valueOf(row.get("operation_id")));
    pending += mediaState.pending();
    blocked += mediaState.failed();
    try {
      var verified = json.readTree(String.valueOf(row.get("result_json")));
      if (!verified.path("verified").asBoolean() || !RULE_VERSION.equals(row.get("rule_version"))
          || !List.of("DB_COMMITTED", "COMPLETE").contains(row.get("status"))) {
        throw new IllegalStateException("退出凭证未证明清理校验完成");
      }
      List<String> retained = json.convertValue(verified.path("retained"),
          new com.fasterxml.jackson.core.type.TypeReference<List<String>>() { });
      return new StoreExitResult(String.valueOf(row.get("operation_id")), storeId, "CLEARED",
          blocked > 0 || recoveryAttention ? "ATTENTION" : pending == 0 && "COMPLETE".equals(row.get("status")) ? "COMPLETE" : "PENDING", pending, retained);
    } catch (JsonProcessingException exception) { throw new IllegalStateException("退出凭证无法校验", exception); }
  }

  public StoreExitResult existingResult(long storeId, String planHash) {
    StoreExitResult result = result(storeId);
    String original = jdbc.queryForObject("SELECT plan_hash FROM store_exit_operations WHERE store_id=?", String.class, storeId);
    if (!java.util.Objects.equals(original, planHash)) {
      throw new IllegalArgumentException("删除计划不匹配，请核对原操作结果");
    }
    return result;
  }

  @Transactional
  public void retry(long storeId) {
    var rows = jdbc.queryForList("SELECT * FROM store_exit_operations WHERE store_id=? FOR UPDATE", storeId);
    Map<String, Object> receipt = rows.isEmpty() ? journal.entries().stream()
        .filter(e -> e.storeId() == storeId && "COMMITTED".equals(e.stage())).findFirst()
        .orElseThrow(() -> new IllegalArgumentException("退出凭证不存在，不能自动重试")).receipt() : rows.getFirst();
    Object creator = receipt.get("store_created_by_account_id");
    DataScope.requireAccess(identities.require(), creator == null ? null : number(creator));
    jdbc.update("""
        INSERT INTO store_exit_events(operation_id,store_id,tenant_id,operator_account_id,result,reason_code)
        VALUES (?,?,?,?,'PENDING','MANUAL_RETRY')
        """, receipt.get("operation_id"), storeId, receipt.get("tenant_id"), identities.require().accountId());
    jdbc.update("""
        UPDATE store_exit_tasks SET status='pending',attempts=0,next_attempt_at=CURRENT_TIMESTAMP(6)
        WHERE operation_id=? AND status IN ('failed','blocked')
        AND NOT(last_error_code<=>'RESTORE_RELEASE_TIME_UNCERTAIN')
        """, receipt.get("operation_id"));
  }

  private Map<String, Object> target(long storeId, boolean lock) {
    var rows = jdbc.queryForList("SELECT id,tenant_id,name,status,created_by_account_id FROM stores WHERE id=?" + (lock ? " FOR UPDATE" : ""), storeId);
    if (rows.isEmpty()) { throw new IllegalArgumentException("门店不存在；需核对删除凭证和残留，不能直接认定已完成"); }
    return rows.getFirst();
  }

  private void authorize(Map<String, Object> store, boolean tenantExit) {
    CurrentIdentity actor = identities.require();
    Long creator = tenantExit
        ? jdbc.queryForObject("SELECT created_by_account_id FROM tenants WHERE id=?", Long.class, store.get("tenant_id"))
        : (store.get("created_by_account_id") == null ? null : number(store.get("created_by_account_id")));
    DataScope.requireAccess(actor, creator);
  }

  public boolean hasForeignTenantRelations(long tenantId) {
    for (String table : registry.tables()) {
      Integer columns = java.util.Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME IN ('tenant_id','store_id')", Integer.class, table), "数量查询缺少结果");
      if (columns == 2 && java.util.Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM " + table
          + " relation WHERE relation.tenant_id=? AND relation.store_id IS NOT NULL AND NOT EXISTS"
          + "(SELECT 1 FROM stores parent WHERE parent.id=relation.store_id AND parent.tenant_id=?)",
          Long.class, tenantId, tenantId), "数量查询缺少结果") > 0) { return true; }
    }
    return false;
  }

  private boolean foreignReferences(StoreExitScope scope) {
    for (String table : registry.tables()) {
      Long columns = java.util.Objects.requireNonNull(jdbc.queryForObject("""
          SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
          AND TABLE_NAME=? AND COLUMN_NAME IN ('store_id','tenant_id')
          """, Long.class, table), "数量查询缺少结果");
      if (columns == 2 && java.util.Objects.requireNonNull(jdbc.queryForObject(
          "SELECT COUNT(*) FROM " + table + " WHERE store_id=? AND NOT(tenant_id<=>?)",
          Long.class, scope.storeId(), scope.tenantId()), "数量查询缺少结果") > 0) { return true; }
    }
    if (java.util.Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM suppliers WHERE store_id=? AND NOT(owner_scope='store' AND owner_id=?)",
        Long.class, scope.storeId(), scope.storeId()), "数量查询缺少结果") > 0) { return true; }
    Long supplierRefs = java.util.Objects.requireNonNull(jdbc.queryForObject("""
        SELECT COUNT(*) FROM suppliers s WHERE s.store_id=? AND (
          EXISTS(SELECT 1 FROM slab_inventory p WHERE p.supplier_id=s.id) OR
          EXISTS(SELECT 1 FROM finished_products p WHERE p.supplier_id=s.id) OR
          EXISTS(SELECT 1 FROM accessory_products p WHERE p.supplier_id=s.id))
        """, Long.class, scope.storeId()), "数量查询缺少结果");
    Long categoryRefs = java.util.Objects.requireNonNull(jdbc.queryForObject("""
        SELECT COUNT(*) FROM store_categories c WHERE c.store_id=? AND (
          EXISTS(SELECT 1 FROM store_categories child WHERE child.parent_id=c.id AND child.store_id<>c.store_id) OR
          EXISTS(SELECT 1 FROM store_finished_products p WHERE p.store_category_id=c.id AND p.store_id<>c.store_id) OR
          EXISTS(SELECT 1 FROM store_accessory_products p WHERE p.store_category_id=c.id AND p.store_id<>c.store_id) OR
          EXISTS(SELECT 1 FROM store_price_rules p WHERE p.category_id=c.id AND p.store_id<>c.store_id))
        """, Long.class, scope.storeId()), "数量查询缺少结果");
    Long roleRefs = java.util.Objects.requireNonNull(jdbc.queryForObject("""
        SELECT COUNT(*) FROM roles r WHERE r.store_id=? AND (
          EXISTS(SELECT 1 FROM account_roles a WHERE a.role_id=r.id AND NOT(a.store_id<=>r.store_id)) OR
          EXISTS(SELECT 1 FROM store_price_rules p WHERE p.role_id=r.id AND p.store_id<>r.store_id))
        """, Long.class, scope.storeId()), "数量查询缺少结果");
    return supplierRefs > 0 || categoryRefs > 0 || roleRefs > 0;
  }

  private void auditFailure(String operation, long store, long tenant, Long actor, String result) {
    try {
      auditTransaction.executeWithoutResult(status -> jdbc.update("""
          INSERT INTO store_exit_events(operation_id,store_id,tenant_id,operator_account_id,result,reason_code)
          VALUES (?,?,?,?,?,?)
          """, operation, store, tenant, actor, result, "TRANSACTION_NOT_COMMITTED"));
    } catch (RuntimeException exception) { LOG.error("Store exit failure audit unavailable: {}", operation, exception); }
  }

  private Map<String, Long> inspectModule(StoreExitModule module, StoreExitScope scope) {
    Map<String, Long> counts = module.inspect(jdbc, scope);
    if (counts == null || !counts.keySet().equals(new java.util.HashSet<>(module.tables()))
        || counts.values().stream().anyMatch(count -> count == null || count < 0)) {
      throw new IllegalStateException("门店退出模块未完整报告实际数据范围：" + module.id());
    }
    return counts;
  }

  private String encode(Object value) {
    try { return json.writeValueAsString(value); }
    catch (JsonProcessingException exception) { throw new IllegalStateException("门店退出计划无法序列化", exception); }
  }
  private static long number(Object value) { return value instanceof Number number ? number.longValue() : Long.parseLong(String.valueOf(value)); }
}
