package com.zdm.platform.account;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.SimpleJdbcInsert;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Account IDs identify people; released phone credentials must never reconnect their history. */
@Service
public class AccountLifecycleService {
  public enum Disposition { KEEP, RELEASE_PHONE, DELETE }
  public record Account(Long id, String name, String gender, String status, boolean created) {}
  private record Reference(String table, String column) {}
  private static final Set<String> TENANT_PURGED_TABLES = Set.of(
      "employees", "roles", "employee_invites", "product_categories", "stores");
  private final com.zdm.platform.storeexit.StoreExitAccountReferences exitAccountReferences;
  private final JdbcTemplate jdbc;
  private final SimpleJdbcInsert insert;
  private final com.zdm.platform.storeexit.HistoricIdentifierGuard historicIds;
  private final com.zdm.platform.storeexit.StoreExitRegistry exitRegistry;

  public AccountLifecycleService(JdbcTemplate jdbc, com.zdm.platform.storeexit.HistoricIdentifierGuard historicIds,
      com.zdm.platform.storeexit.StoreExitRegistry exitRegistry,
      com.zdm.platform.storeexit.StoreExitAccountReferences exitAccountReferences) {
    this.exitAccountReferences = exitAccountReferences;
    this.historicIds = historicIds;
    this.exitRegistry = exitRegistry;
    this.jdbc = jdbc;
    this.insert = new SimpleJdbcInsert(jdbc).withTableName("accounts")
        .usingColumns("phone", "display_name", "account_type", "status").usingGeneratedKeyColumns("id");
  }

  public Optional<Account> findByPhoneForUpdate(String phone) {
    // Match deletion's primary-key lock order; locking the phone index first can deadlock.
    List<Long> candidates = jdbc.queryForList("SELECT id FROM accounts WHERE phone = ?", Long.class, phone);
    if (candidates.isEmpty()) {
      return Optional.empty();
    }
    Optional<Account> existing = jdbc.query("SELECT id, display_name, gender, status FROM accounts FORCE INDEX (PRIMARY) WHERE id = ? AND phone = ? FOR UPDATE",
        (rs, row) -> new Account(rs.getLong("id"), rs.getString("display_name"), rs.getString("gender"), rs.getString("status"), false),
        candidates.getFirst(), phone).stream().findFirst();
    return existing.map(this::requireReusableAccount);
  }

  private Account requireReusableAccount(Account account) {
    var history = historicIds.accountExitState(account.id());
    if (history.retired() || (!history.uncertainStores().isEmpty()
        && assessForExit(account.id(), history.uncertainStores(), null) == Disposition.DELETE)) {
      throw new IllegalStateException("该账号的退出结果尚待恢复核验，不能复用历史账号");
    }
    return account;
  }

  @Transactional
  public Account findOrCreate(String phone, String name) {
    Optional<Account> existing = findByPhoneForUpdate(phone);
    if (existing.isPresent()) {
      return existing.get();
    }
    try {
      long watermark = historicIds.reserve("accounts");
      Long id = insert.executeAndReturnKey(Map.of(
          "phone", phone, "display_name", name, "account_type", "person", "status", "enabled")).longValue();
      id = historicIds.skipReserved("accounts", id, watermark);
      return new Account(id, name, null, "enabled", true);
    } catch (DuplicateKeyException exception) {
      // Duplicate insert establishes a current unique-key conflict. Do not reread an older snapshot.
      return jdbc.query("SELECT id, display_name, gender, status FROM accounts WHERE phone=? FOR UPDATE",
          (rs, row) -> new Account(rs.getLong("id"), rs.getString("display_name"), rs.getString("gender"), rs.getString("status"), false),
          phone).stream().findFirst().map(this::requireReusableAccount).orElseThrow(() -> exception);
    }
  }

  @Transactional
  public Account findOrCreate(String phone, String name, String gender) {
    Account account = findOrCreate(phone, name);
    if (account.created()) {
      updatePersonalProfile(account.id(), name, gender);
      return new Account(account.id(), name, gender, account.status(), true);
    }
    return account;
  }

  public void updatePersonalProfile(Long accountId, String name, String gender) {
    if (!org.springframework.util.StringUtils.hasText(name)
        || (gender != null && !List.of("male", "female").contains(gender))) {
      throw new IllegalArgumentException("请填写姓名并选择有效性别");
    }
    jdbc.update("UPDATE accounts SET display_name=?,gender=? WHERE id=?", name.trim(), gender, accountId);
  }

  public void lockAccount(Long accountId) {
    if (accountId != null) {
      List<Long> ids = jdbc.queryForList("SELECT id FROM accounts WHERE id = ? FOR UPDATE", Long.class, accountId);
      if (ids.isEmpty()) {
        throw new IllegalArgumentException("账号已变更，请刷新后重试");
      }
    }
  }

  public boolean isProtected(Long accountId) {
    return accountId != null && (accountId == 1L
        || exists("SELECT 1 FROM accounts WHERE id=? AND account_type <> 'person'", accountId)
        || exists("SELECT 1 FROM account_identities WHERE account_id=? AND identity_type='platform_admin'", accountId)
        || exists("SELECT 1 FROM account_roles ar JOIN roles r ON r.id=ar.role_id WHERE ar.account_id=? AND r.code='SUPER_ADMIN'", accountId));
  }

  /** Preview the result after deleting the specified tenant, or classify current references when null. */
  public Disposition assess(Long accountId, Long removedTenantId) {
    if (accountId == null || isProtected(accountId) || hasMembership(accountId, removedTenantId)) {
      return Disposition.KEEP;
    }
    return hasHistory(accountId, removedTenantId) ? Disposition.RELEASE_PHONE : Disposition.DELETE;
  }

  private boolean hasMembership(Long accountId, Long removedTenantId) {
    String scope = removedTenantId == null ? "" : " AND (tenant_id IS NULL OR tenant_id <> " + removedTenantId + ")";
    if (exists("SELECT 1 FROM employees WHERE account_id=?" + scope, accountId)
        || exists("SELECT 1 FROM account_roles WHERE account_id=?" + scope, accountId)) {
      return true;
    }
    String identityScope = removedTenantId == null ? ""
        : " AND (i.tenant_id IS NULL OR i.tenant_id <> " + removedTenantId + ")";
    // A disabled employee still counts. A legacy identity whose employee was deleted does not.
    return exists("""
        SELECT 1 FROM account_identities i WHERE i.account_id=?
          AND (i.identity_type <> 'employee' OR EXISTS (
            SELECT 1 FROM employees e WHERE e.id=i.subject_id AND e.account_id=i.account_id
              AND e.client_code=i.client_code AND e.tenant_id <=> i.tenant_id AND e.store_id <=> i.store_id))
        """ + identityScope, accountId);
  }

  private boolean hasHistory(Long accountId, Long removedTenantId) {
    return hasHistory(accountId, removedTenantId, Set.of());
  }

  private boolean hasHistory(Long accountId, Long removedTenantId, Set<Long> removedStores) {
    // Include conventional account columns AND foreign keys, including references without FK constraints.
    List<Reference> references = jdbc.query("""
        SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND (COLUMN_NAME='account_id' OR RIGHT(COLUMN_NAME,11)='_account_id')
        UNION
        SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_SCHEMA=DATABASE()
          AND REFERENCED_TABLE_NAME='accounts' AND REFERENCED_COLUMN_NAME='id'
        """, (rs, row) -> new Reference(rs.getString("TABLE_NAME"), rs.getString("COLUMN_NAME")));
    for (Reference ref : references) {
      if (Set.of("accounts", "auth_sessions", "account_identities", "account_roles").contains(ref.table())
          || ("employees".equals(ref.table()) && "account_id".equals(ref.column()))) {
        continue;
      }
      String scope = storeRemovalClause(ref, removedStores);
      if (removedTenantId != null) {
        if (TENANT_PURGED_TABLES.contains(ref.table())) {
          scope += " AND (tenant_id IS NULL OR tenant_id <> " + removedTenantId + ")";
        } else if ("store_categories".equals(ref.table())) {
          scope += " AND store_id NOT IN (SELECT id FROM stores WHERE tenant_id=" + removedTenantId + ")";
        } else if ("tenants".equals(ref.table())) {
          scope += " AND id <> " + removedTenantId;
        } else if ("category_template_versions".equals(ref.table())) {
          scope += " AND category_id NOT IN (SELECT id FROM product_categories WHERE tenant_id=" + removedTenantId + ")";
        }
      }
      if (exists("SELECT 1 FROM " + identifier(ref.table()) + " WHERE " + identifier(ref.column()) + "=?" + scope, accountId)) {
        return true;
      }
    }
    return false;
  }

  private String identifier(String name) {
    if (!name.matches("[a-zA-Z0-9_]+")) {
      throw new IllegalStateException("无法确认账号引用字段");
    }
    return "`" + name + "`";
  }

  @Transactional
  public Disposition releaseIfUnbound(Long accountId) {
    if (accountId == null) {
      return Disposition.KEEP;
    }
    lockAccount(accountId);
    Disposition result = assess(accountId, null);
    if (result == Disposition.KEEP) {
      return result;
    }
    jdbc.update("DELETE FROM auth_sessions WHERE account_id=?", accountId);
    // Only dangling identities remain here; live disabled relationships were checked above.
    jdbc.update("DELETE FROM account_identities WHERE account_id=?", accountId);
    if (result == Disposition.RELEASE_PHONE) {
      jdbc.update("UPDATE accounts SET phone=NULL,status='disabled' WHERE id=?", accountId);
    } else {
      jdbc.update("DELETE FROM accounts WHERE id=?", accountId);
    }
    return result;
  }

  public boolean hasPhoneCredential(Long accountId) {
    return !jdbc.queryForList("SELECT id FROM accounts WHERE id=? AND phone IS NOT NULL AND TRIM(phone)<>'' LIMIT 1 FOR UPDATE", Long.class, accountId).isEmpty();
  }

  /** Only references in rows this exit will remove; never a global orphan-account sweep. */
  public List<Long> storeExitCandidates(com.zdm.platform.storeexit.StoreExitScope scope) {
    java.util.Set<Long> result = new java.util.TreeSet<>(storeExitRelationshipCandidates(scope.storeId()));
    for (var module : exitRegistry.modules()) {
      result.addAll(module.referencedAccounts(jdbc, scope, exitAccountReferences));
    }
    for (String field : exitAccountReferences.liveFields("stores")) {
      if (!field.matches("[a-z_]+")) { throw new IllegalStateException("账号引用字段不合法"); }
      result.addAll(jdbc.queryForList("SELECT " + field + " FROM stores WHERE id=? AND tenant_id=? AND "
          + field + " IS NOT NULL AND EXISTS(SELECT 1 FROM accounts a WHERE a.id=stores." + field + ")",
          Long.class, scope.storeId(), scope.tenantId()));
    }
    return List.copyOf(result);
  }

  public List<Long> storeExitRelationshipCandidates(long storeId) {
    return jdbc.queryForList("""
        SELECT account_id FROM account_identities WHERE store_id=?
        UNION SELECT account_id FROM employees WHERE store_id=? AND account_id IS NOT NULL
        UNION SELECT account_id FROM account_roles WHERE store_id=? ORDER BY account_id
        """, Long.class, storeId, storeId, storeId);
  }

  /** Store exit is deliberately separate from normal employee/identity retirement. */
  @Transactional
  public Disposition releaseForStoreExit(Long accountId) {
    if (accountId == null) { return Disposition.KEEP; }
    lockAccount(accountId);
    if (assessForExit(accountId, Set.of(), null) == Disposition.KEEP) { return Disposition.KEEP; }
    if (requiresHistoricalName(accountId)) {
    jdbc.update("""
        INSERT INTO store_exit_actor_snapshots(account_id,display_name_at_exit)
        SELECT id,display_name FROM accounts WHERE id=?
        ON DUPLICATE KEY UPDATE account_id=store_exit_actor_snapshots.account_id
        """, accountId);
    }
    jdbc.update("DELETE FROM auth_sessions WHERE account_id=?", accountId);
    jdbc.update("DELETE FROM accounts WHERE id=?", accountId);
    return Disposition.DELETE;
  }

  public boolean requiresHistoricalName(Long accountId) {
    for (String field : exitAccountReferences.historicalFields()) {
      String[] parts = field.split("\\.", 2);
      if ("store_exit_actor_snapshots".equals(parts[0])) { continue; }
      if (exists("SELECT 1 FROM " + identifier(parts[0]) + " WHERE " + identifier(parts[1]) + "=?", accountId)) { return true; }
    }
    return false;
  }

  /** Capture before tenant cleanup: tenant-owned identities keep their original retirement policy. */
  public boolean isStoreOnlyExitAccount(Long accountId, long tenantId) {
    String tenantScope = " AND tenant_id=" + tenantId;
    if (exists("SELECT 1 FROM tenants WHERE account_id=? AND id=" + tenantId, accountId)) { return false; }
    boolean storeRelation = false;
    for (String table : List.of("account_identities", "employees", "account_roles")) {
      if (exists("SELECT 1 FROM " + table + " WHERE account_id=?" + tenantScope + " AND store_id IS NULL", accountId)) { return false; }
      storeRelation |= exists("SELECT 1 FROM " + table + " WHERE account_id=?" + tenantScope + " AND store_id IS NOT NULL", accountId);
    }
    if (storeRelation) { return true; }
    // A prior store exit may have removed every identity while another store's live reference retained this account.
    for (Long store : jdbc.queryForList("SELECT id FROM stores WHERE tenant_id=? ORDER BY id", Long.class, tenantId)) {
      if (storeExitCandidates(com.zdm.platform.storeexit.StoreExitScope.capture(jdbc, store, tenantId)).contains(accountId)) {
        return true;
      }
    }
    return false;
  }

  public Disposition assessForTenantExit(Long accountId, Set<Long> removedStores, long tenantId) {
    if (isStoreOnlyExitAccount(accountId, tenantId)) { return assessForExit(accountId, removedStores, tenantId); }
    if (accountId == null || isProtected(accountId) || hasMembership(accountId, tenantId)) { return Disposition.KEEP; }
    return hasHistory(accountId, tenantId, removedStores) ? Disposition.RELEASE_PHONE : Disposition.DELETE;
  }

  /** Read-only projection of the same live-reference policy used after actual cleanup. */
  public Disposition assessForExit(Long accountId, Set<Long> removedStores, Long removedTenant) {
    if (accountId == null || isProtected(accountId)) { return Disposition.KEEP; }
    List<Reference> references = jdbc.query("""
        SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND (COLUMN_NAME='account_id' OR RIGHT(COLUMN_NAME,11)='_account_id')
        UNION SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_SCHEMA=DATABASE()
          AND REFERENCED_TABLE_NAME='accounts' AND REFERENCED_COLUMN_NAME='id'
        """, (rs, row) -> new Reference(rs.getString(1), rs.getString(2)));
    for (Reference reference : references) {
      if (java.util.Set.of("accounts", "auth_sessions").contains(reference.table())
          || exitAccountReferences.historical(reference.table() + "." + reference.column())) { continue; }
      String remaining = storeRemovalClause(reference, removedStores);
      if (removedTenant != null) {
        if (TENANT_PURGED_TABLES.contains(reference.table()) || java.util.Set.of("account_identities", "account_roles").contains(reference.table())) {
          if ("stores".equals(reference.table()) || !"store_categories".equals(reference.table())) {
            remaining += " AND (tenant_id IS NULL OR tenant_id<>" + removedTenant + ")";
          }
        } else if ("tenants".equals(reference.table())) { remaining += " AND id<>" + removedTenant; }
        else if ("category_template_versions".equals(reference.table())) {
          remaining += " AND category_id NOT IN (SELECT id FROM product_categories WHERE tenant_id=" + removedTenant + ")";
        }
      }
      // Remaining operational references still use the live account (including current creator names).
      if (exists("SELECT 1 FROM " + identifier(reference.table()) + " WHERE " + identifier(reference.column()) + "=?" + remaining, accountId)) {
        return Disposition.KEEP;
      }
    }
    return Disposition.DELETE;
  }

  private String storeRemovalClause(Reference reference, Set<Long> removedStores) {
    String remaining = "";
      if (!removedStores.isEmpty() && (exitRegistry.tables().contains(reference.table()) || "stores".equals(reference.table()))) {
        String ids = removedStores.stream().sorted().map(String::valueOf).collect(java.util.stream.Collectors.joining(","));
        if ("stores".equals(reference.table())) { remaining += " AND id NOT IN (" + ids + ")"; }
        else if (java.util.Objects.requireNonNull(jdbc.queryForObject("""
            SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
            AND TABLE_NAME=? AND COLUMN_NAME='store_id'
            """, Integer.class, reference.table()), "数量查询缺少结果") > 0) {
          remaining += " AND (store_id IS NULL OR store_id NOT IN (" + ids + "))";
        } else if ("store_customer_followups".equals(reference.table())) {
          remaining += " AND customer_id NOT IN (SELECT id FROM store_customers WHERE store_id IN (" + ids + "))";
        } else if ("store_finished_sale_prices".equals(reference.table())) {
          remaining += " AND listing_id NOT IN (SELECT id FROM store_finished_products WHERE store_id IN (" + ids + "))";
        } else if ("store_accessory_sale_prices".equals(reference.table())) {
          remaining += " AND listing_id NOT IN (SELECT id FROM store_accessory_products WHERE store_id IN (" + ids + "))";
        } else if ("employee_invite_acceptances".equals(reference.table())) {
          remaining += " AND invite_id NOT IN (SELECT id FROM employee_invites WHERE store_id IN (" + ids + "))";
        } else if ("product_state_activity".equals(reference.table())) {
          remaining += " AND NOT(business_client_code='store' AND ((kind='store-finished' AND record_id IN "
              + "(SELECT id FROM store_finished_products WHERE store_id IN (" + ids + "))) OR (kind='store-accessory' AND record_id IN "
              + "(SELECT id FROM store_accessory_products WHERE store_id IN (" + ids + ")))))";
        }
      }
    return remaining;
  }

  private boolean exists(String sql, Long accountId) {
    // A locking read sees memberships committed before our account lock, even under REPEATABLE READ.
    return !jdbc.queryForList(sql + " LIMIT 1 FOR UPDATE", accountId).isEmpty();
  }
}
