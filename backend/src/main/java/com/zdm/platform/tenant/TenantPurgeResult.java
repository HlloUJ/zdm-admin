package com.zdm.platform.tenant;

public record TenantPurgeResult(
    int tenantDeleteCount,
    int storeDeleteCount,
    int employeeDeleteCount,
    int roleDeleteCount,
    int accountDeleteCount,
    int accountRetainCount,
    int phoneReleaseCount,
    java.util.List<com.zdm.platform.storeexit.StoreExitResult> storeResults) {
  public TenantPurgeResult { storeResults = java.util.List.copyOf(storeResults); }
}
