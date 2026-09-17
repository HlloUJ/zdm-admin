package com.zdm.platform.auth;

public record IdentityContextResponse(
    Long identityId,
    String identityType,
      String clientCode,
    Long tenantId,
    Long storeId,
    String tenantName,
    String storeName,
    String storeType) {}
