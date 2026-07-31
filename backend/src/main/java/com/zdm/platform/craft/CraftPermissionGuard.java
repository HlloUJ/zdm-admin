package com.zdm.platform.craft;

import java.util.Arrays;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

@Component
public class CraftPermissionGuard {
  public static final String PREFIX = "admin.product-data-center.finished-stock-craft";

  private final JdbcTemplate jdbcTemplate;

  public CraftPermissionGuard(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public void requireView() {
    requirePermissions(PREFIX + ".view");
  }

  public void requireCreate() {
    requirePermissions(PREFIX + ".view", PREFIX + ".create");
  }

  public void requireEdit() {
    requirePermissions(PREFIX + ".view", PREFIX + ".edit");
  }

  public void requireToggleStatus() {
    requirePermissions(PREFIX + ".view", PREFIX + ".toggle-status");
  }

  public void requireDelete() {
    requirePermissions(PREFIX + ".view", PREFIX + ".delete");
  }

  public void requireImageUpload() {
    if (isDevelopmentPrincipal()) {
      return;
    }
    Long accountId = currentAccountId();
    if (accountId == null
        || !isGranted(accountId, PREFIX + ".view")
        || (!isGranted(accountId, PREFIX + ".create") && !isGranted(accountId, PREFIX + ".edit"))) {
      throw new AccessDeniedException("无权上传工艺图片");
    }
  }

  private void requirePermissions(String... permissions) {
    if (isDevelopmentPrincipal()) {
      return;
    }
    Long accountId = currentAccountId();
    if (accountId == null || Arrays.stream(permissions).anyMatch(permission -> !isGranted(accountId, permission))) {
      throw new AccessDeniedException("无权执行当前工艺操作");
    }
  }

  private boolean isGranted(Long accountId, String permission) {
    Integer count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM account_roles ar
        JOIN accounts a
          ON a.id = ar.account_id
         AND a.status = 'enabled'
        JOIN roles r
          ON r.id = ar.role_id
         AND r.status = 'enabled'
         AND r.client_code = 'admin'
        WHERE ar.account_id = ?
          AND ar.client_code = 'admin'
          AND EXISTS (
            SELECT 1
            FROM account_identities ai
            WHERE ai.account_id = ar.account_id
              AND ai.client_code = ar.client_code
              AND ai.status = 'enabled'
              AND ai.tenant_id <=> ar.tenant_id
              AND ai.store_id <=> ar.store_id
          )
          AND (
            r.code = 'SUPER_ADMIN'
            OR FIND_IN_SET('all', REPLACE(COALESCE(r.function_permissions, ''), ' ', '')) > 0
            OR FIND_IN_SET(?, REPLACE(COALESCE(r.function_permissions, ''), ' ', '')) > 0
          )
        """,
        Integer.class,
        accountId,
        permission);
    return count != null && count > 0;
  }

  private boolean isDevelopmentPrincipal() {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    return authentication != null && "admin".equals(authentication.getName());
  }

  private Long currentAccountId() {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication == null || authentication.getName() == null) {
      return null;
    }
    String principal = authentication.getName();
    if (!principal.startsWith("account:")) {
      return null;
    }
    try {
      return Long.parseLong(principal.substring("account:".length()));
    } catch (NumberFormatException exception) {
      return null;
    }
  }
}
