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

  public void record(CurrentIdentity identity, String method, String path, int status) {
    try {
      jdbcTemplate.update(
          """
          INSERT INTO security_audit_logs
            (account_id, identity_id, client_code, request_method, request_path, result_status, result)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          """,
          identity == null ? null : identity.accountId(),
          identity == null ? null : identity.identityId(),
          identity == null ? null : identity.clientCode(),
          method,
          path,
          status,
          status < 400 ? "success" : "denied");
    } catch (RuntimeException ex) {
      LOGGER.error("Failed to persist security audit log", ex);
    }
  }
}
