package com.zdm.platform.security;

import java.util.List;

public record CurrentIdentity(
    Long sessionId,
    Long accountId,
    Long identityId,
    Long employeeId,
    String clientCode,
    Long tenantId,
    Long storeId,
    String displayName,
    String dataPermission,
    List<String> roles,
    List<String> permissions) {
  public CurrentIdentity {
    roles = List.copyOf(roles);
    permissions = List.copyOf(permissions);
  }

  public boolean isSuperAdmin() {
    return roles.contains("SUPER_ADMIN") || permissions.contains("all");
  }
}
