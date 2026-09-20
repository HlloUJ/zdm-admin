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
    List<String> blockers) {
  public TenantPurgePreview {
    blockers = List.copyOf(blockers);
  }
}
