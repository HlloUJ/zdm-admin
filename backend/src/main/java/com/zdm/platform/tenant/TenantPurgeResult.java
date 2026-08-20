package com.zdm.platform.tenant;

public record TenantPurgeResult(
    int tenantDeleteCount,
    int storeDeleteCount,
    int employeeDeleteCount,
    int roleDeleteCount,
    int accountDeleteCount,
    int accountRetainCount) {}
