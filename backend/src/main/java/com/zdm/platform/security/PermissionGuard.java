package com.zdm.platform.security;

import java.util.Arrays;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;

@Component
public class PermissionGuard {
  private final CurrentIdentityProvider identityProvider;

  public PermissionGuard(CurrentIdentityProvider identityProvider) {
    this.identityProvider = identityProvider;
  }

  public CurrentIdentity identity() {
    return identityProvider.require();
  }

  public boolean hasPermission(String permission) {
    CurrentIdentity identity = identity();
    return identity.isSuperAdmin() || identity.permissions().contains(permission);
  }

  public boolean hasView(String permissionPrefix) {
    CurrentIdentity identity = identity();
    if (identity.isSuperAdmin()) {
      return true;
    }
    return identity.permissions().stream()
        .anyMatch(permission -> permission.equals(permissionPrefix + ".view")
            || (permission.startsWith(permissionPrefix + ".") && permission.endsWith(".view")));
  }

  public void requirePermission(String permission) {
    if (!hasPermission(permission)) {
      throw new AccessDeniedException("无权执行当前操作");
    }
  }

  public void requireAnyPermission(String... permissions) {
    if (Arrays.stream(permissions).noneMatch(this::hasPermission)) {
      throw new AccessDeniedException("无权执行当前操作");
    }
  }

  public void requireView(String permissionPrefix) {
    if (!hasView(permissionPrefix)) {
      throw new AccessDeniedException("无权访问当前功能");
    }
  }

  public void requireAllData() {
    CurrentIdentity identity = identity();
    if (!identity.isSuperAdmin() && !"all".equals(identity.dataPermission())) {
      throw new AccessDeniedException("当前数据权限不允许访问该资源");
    }
  }

  public void requireSuperAdmin() {
    if (!identity().isSuperAdmin()) {
      throw new AccessDeniedException("仅超级管理员可执行当前操作");
    }
  }
}
