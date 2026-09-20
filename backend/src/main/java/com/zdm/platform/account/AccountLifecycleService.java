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
  public record Account(Long id, String name, String status, boolean created) {}
  private record Reference(String table, String column) {}
  private static final Set<String> TENANT_PURGED_TABLES = Set.of(
      "employees", "roles", "employee_invites", "product_categories", "stores");
  private final JdbcTemplate jdbc;
  private final SimpleJdbcInsert insert;

  public AccountLifecycleService(JdbcTemplate jdbc) {
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
    return jdbc.query("SELECT id, display_name, status FROM accounts FORCE INDEX (PRIMARY) WHERE id = ? AND phone = ? FOR UPDATE",
        (rs, row) -> new Account(rs.getLong("id"), rs.getString("display_name"), rs.getString("status"), false),
        candidates.getFirst(), phone).stream().findFirst();
  }

  @Transactional
  public Account findOrCreate(String phone, String name) {
    Optional<Account> existing = findByPhoneForUpdate(phone);
    if (existing.isPresent()) {
      return existing.get();
    }
    try {
      Long id = insert.executeAndReturnKey(Map.of(
          "phone", phone, "display_name", name, "account_type", "person", "status", "enabled")).longValue();
      return new Account(id, name, "enabled", true);
    } catch (DuplicateKeyException exception) {
      // Duplicate insert establishes a current unique-key conflict. Do not reread an older snapshot.
      return jdbc.query("SELECT id, display_name, status FROM accounts WHERE phone=? FOR UPDATE",
          (rs, row) -> new Account(rs.getLong("id"), rs.getString("display_name"), rs.getString("status"), false),
          phone).stream().findFirst().orElseThrow(() -> exception);
    }
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
      String scope = "";
      if (removedTenantId != null) {
        if (TENANT_PURGED_TABLES.contains(ref.table())) {
          scope = " AND (tenant_id IS NULL OR tenant_id <> " + removedTenantId + ")";
        } else if ("store_categories".equals(ref.table())) {
          scope = " AND store_id NOT IN (SELECT id FROM stores WHERE tenant_id=" + removedTenantId + ")";
        } else if ("tenants".equals(ref.table())) {
          scope = " AND id <> " + removedTenantId;
        } else if ("category_template_versions".equals(ref.table())) {
          scope = " AND category_id NOT IN (SELECT id FROM product_categories WHERE tenant_id=" + removedTenantId + ")";
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

  private boolean exists(String sql, Long accountId) {
    // A locking read sees memberships committed before our account lock, even under REPEATABLE READ.
    return !jdbc.queryForList(sql + " LIMIT 1 FOR UPDATE", accountId).isEmpty();
  }
}
