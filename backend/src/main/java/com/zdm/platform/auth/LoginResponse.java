package com.zdm.platform.auth;

import java.util.List;

public record LoginResponse(String token, LoginUser user) {
  public record LoginUser(
      Long id,
      Long identityId,
      String identityType,
      String name,
      String phone,
      List<String> roles,
      List<String> roleNames,
      List<String> permissions,
      Long employeeId,
      Long tenantId,
      Long storeId,
      String tenantName,
      String storeName,
      String storeType,
      String dataPermission) {
    public LoginUser {
      roles = List.copyOf(roles);
      roleNames = List.copyOf(roleNames);
      permissions = List.copyOf(permissions);
    }
  }
}
