package com.zdm.platform.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class SecurityAuditService {
  private static final Logger LOGGER = LoggerFactory.getLogger(SecurityAuditService.class);

  private final JdbcTemplate jdbcTemplate;

  public SecurityAuditService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public record AuditContext(CurrentIdentity identity, String identityType, String tenantName,
      String storeName, java.time.LocalDateTime capturedAt) { }

  /** Capture before the request changes names, identities or organizations. */
  public AuditContext capture(CurrentIdentity identity) {
    if (identity == null) { return new AuditContext(null, null, null, null, null); }
    try {
      return jdbcTemplate.queryForObject("""
          SELECT i.identity_type, ta.display_name AS tenant_name, s.name AS store_name,
            CURRENT_TIMESTAMP(6) AS captured_at
          FROM (SELECT 1) anchor
          LEFT JOIN account_identities i ON i.id=? AND i.account_id=? AND i.client_code=?
          LEFT JOIN tenants t ON t.id=?
          LEFT JOIN accounts ta ON ta.id=t.account_id
          LEFT JOIN stores s ON s.id=? AND s.tenant_id=?
          """, (rs, row) -> new AuditContext(identity, rs.getString("identity_type"),
              rs.getString("tenant_name"), rs.getString("store_name"), rs.getTimestamp("captured_at").toLocalDateTime()),
          identity.identityId(), identity.accountId(), identity.clientCode(), identity.tenantId(), identity.storeId(), identity.tenantId());
    } catch (RuntimeException exception) {
      LOGGER.error("Failed to capture security audit scope", exception);
      return new AuditContext(identity, null, null, null, null);
    }
  }

  public void record(CurrentIdentity identity, String method, String path, int status) {
    recordCaptured(capture(identity), method, path, status);
  }

  public void recordCaptured(AuditContext context, String method, String path, int status) {
    CurrentIdentity identity = context.identity();
    try {
      jdbcTemplate.update(
          """
          INSERT INTO security_audit_logs
            (account_id, identity_id, client_code, request_method, request_path, result_status, result,
             actor_name_snapshot,identity_type_snapshot,tenant_id_snapshot,tenant_name_snapshot,
             store_id_snapshot,store_name_snapshot,scope_snapshot_source,scope_snapshot_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """,
          identity == null ? null : identity.accountId(),
          identity == null ? null : identity.identityId(),
          identity == null ? null : identity.clientCode(),
          method,
          path,
          status,
          status < 400 ? "success" : "denied",
          identity == null ? null : identity.displayName(), context.identityType(),
          identity == null ? null : identity.tenantId(), context.tenantName(),
          identity == null ? null : identity.storeId(), context.storeName(),
          context.capturedAt() == null ? null : "request-start", context.capturedAt());
    } catch (RuntimeException ex) {
      LOGGER.error("Failed to persist security audit log", ex);
    }
  }

  public boolean storeHistoryVerifiable(java.util.List<Long> identities) {
    if (identities.isEmpty()) { return true; }
    String placeholders = String.join(",", java.util.Collections.nCopies(identities.size(), "?"));
    return Long.valueOf(0).equals(jdbcTemplate.queryForObject("""
        SELECT COUNT(*) FROM security_audit_logs a WHERE a.scope_snapshot_source IS NULL
        AND a.identity_id IN (
        """ + placeholders + ") AND NOT EXISTS (SELECT 1 FROM account_identities i WHERE i.id=a.identity_id"
        + " AND i.account_id=a.account_id AND i.client_code=a.client_code)", Long.class, identities.toArray()));
  }

  /** This is a retirement snapshot, never a claim to know old names at the event time. */
  @org.springframework.transaction.annotation.Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
  public void preserveStoreHistory(long store, long tenant, java.util.List<Long> identities, String storeName, String tenantName, String capturedAt) {
    if (identities.isEmpty()) { return; }
    if (!storeHistoryVerifiable(identities)) { throw new IllegalStateException("门店历史安全审计的身份归属无法核实"); }
    jdbcTemplate.update("""
        UPDATE security_audit_logs a
        JOIN account_identities i ON i.id=a.identity_id AND i.account_id=a.account_id AND i.client_code=a.client_code
        JOIN stores s ON s.id=i.store_id AND s.tenant_id=i.tenant_id
        SET a.identity_type_snapshot=i.identity_type,
          a.tenant_id_snapshot=i.tenant_id,a.tenant_name_snapshot=?,
          a.store_id_snapshot=i.store_id,a.store_name_snapshot=?,
          a.scope_snapshot_source=?,a.scope_snapshot_at=COALESCE(?,CURRENT_TIMESTAMP(6))
        WHERE i.store_id=? AND i.tenant_id=? AND a.scope_snapshot_source IS NULL
        """, tenantName, storeName, capturedAt == null ? "store-exit" : "exit-recovery", capturedAt, store, tenant);
    String placeholders = String.join(",", java.util.Collections.nCopies(identities.size(), "?"));
    if (!Long.valueOf(0).equals(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM security_audit_logs"
        + " WHERE scope_snapshot_source IS NULL AND identity_id IN (" + placeholders + ")", Long.class, identities.toArray()))) {
      throw new IllegalStateException("门店历史安全审计快照未完整保留");
    }
  }
}
