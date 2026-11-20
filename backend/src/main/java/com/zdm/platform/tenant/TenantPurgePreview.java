package com.zdm.platform.tenant;

import java.util.List;

public record TenantPurgePreview(
    boolean eligible,
    String tenantName,
    int storeCount,
    int employeeCount,
    int roleCount,
    int accountDeleteCount,
    int accountRetainCount,
    int phoneReleaseCount,
    List<String> blockers, java.util.Map<Long, String> storePlans) {
  public TenantPurgePreview {
    blockers = List.copyOf(blockers);
    storePlans = java.util.Map.copyOf(storePlans);
  }
}
