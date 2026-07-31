package com.zdm.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.security.access.AccessDeniedException;

class PermissionGuardTest {
  private CurrentIdentityProvider identityProvider;
  private PermissionGuard permissionGuard;

  @BeforeEach
  void setUp() {
    identityProvider = Mockito.mock(CurrentIdentityProvider.class);
    permissionGuard = new PermissionGuard(identityProvider);
  }

  @Test
  void nestedViewPermissionOpensItsOwningPage() {
    when(identityProvider.require()).thenReturn(identity(
        "all",
        List.of("admin.permission-management.role-management.operation-platform.view")));

    assertThat(permissionGuard.hasView("admin.permission-management.role-management")).isTrue();
    assertThat(permissionGuard.hasView("admin.tenant.tenant-management")).isFalse();
  }

  @Test
  void selfDataScopeCannotUseUnscopedCrudEndpoint() {
    when(identityProvider.require()).thenReturn(identity(
        "self",
        List.of("admin.tenant.tenant-management.view")));

    assertThatThrownBy(permissionGuard::requireAllData)
        .isInstanceOf(AccessDeniedException.class)
        .hasMessage("当前数据权限不允许访问该资源");
  }

  @Test
  void superAdminBypassesPermissionAndDataChecks() {
    when(identityProvider.require()).thenReturn(new CurrentIdentity(
        1L,
        1L,
        1L,
        1L,
        "admin",
        1L,
        1L,
        "超级管理员",
        "all",
        List.of("SUPER_ADMIN"),
        List.of("all")));

    permissionGuard.requirePermission("admin.anything.delete");
    permissionGuard.requireAllData();
  }

  private CurrentIdentity identity(String dataPermission, List<String> permissions) {
    return new CurrentIdentity(
        2L,
        2L,
        2L,
        2L,
        "admin",
        1L,
        1L,
        "测试员工",
        dataPermission,
        List.of("ADMIN_MANAGER"),
        permissions);
  }
}
