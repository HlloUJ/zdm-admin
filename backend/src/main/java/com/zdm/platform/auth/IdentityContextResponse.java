package com.zdm.platform.auth;

public record IdentityContextResponse(
    Long identityId,
    String identityType,
    Long tenantId,
    Long storeId,
    String tenantName,
    String storeName,
    String storeType) {}
