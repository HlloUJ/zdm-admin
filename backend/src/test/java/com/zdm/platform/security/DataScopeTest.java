package com.zdm.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

class DataScopeTest {
  private CurrentIdentity identity(String scope, boolean superAdmin) {
    return new CurrentIdentity(1L, 11L, 1L, 1L, "admin", null, null, "同名用户", scope,
        superAdmin ? List.of("SUPER_ADMIN") : List.of("OPERATOR"), List.of());
  }

  @Test
  void selfUsesAccountIdAndNeverClaimsUnknownOwnership() {
    var user = identity("self", false);
    assertThat(DataScope.canAccess(user, 11L)).isTrue();
    assertThat(DataScope.canAccess(user, 22L)).isFalse();
    assertThat(DataScope.canAccess(user, null)).isFalse();
    assertThatThrownBy(() -> DataScope.requireAccess(user, 22L)).isInstanceOf(AccessDeniedException.class);
  }

  @Test
  void allCanReadAndOperateOtherCreators() {
    var user = identity("all", false);
    assertThat(DataScope.canAccess(user, 22L)).isTrue();
    DataScope.requireAccess(user, 22L);
    DataScope.requireAccess(user, null);
  }

  @Test
  void onlySuperAdminBypassesMissingOrSelfDataPermission() {
    for (String value : List.of("self", "", "invalid")) {
      DataScope.requireAccess(identity(value, true), 22L);
      DataScope.requireAccess(identity(value, true), null);
    }
    for (String value : List.of("", "invalid")) {
      assertThatThrownBy(() -> DataScope.canAccess(identity(value, false), 11L))
          .isInstanceOf(AccessDeniedException.class);
    }
  }
  @Test
  void allFunctionPermissionsDoNotPromoteOrdinaryRoleToSuperAdmin() {
    var user = new CurrentIdentity(1L, 11L, 1L, 1L, "admin", null, null, "普通管理员", "self",
        List.of("OPERATOR"), List.of("all"));
    assertThat(user.isSuperAdmin()).isFalse();
    assertThat(DataScope.canAccess(user, 22L)).isFalse();
    var identities = org.mockito.Mockito.mock(CurrentIdentityProvider.class);
    org.mockito.Mockito.when(identities.require()).thenReturn(user);
    var guard = new PermissionGuard(identities);
    assertThat(guard.hasPermission("admin.product-data-center.slab-origin.edit")).isTrue();
    assertThatThrownBy(guard::requireSuperAdmin).isInstanceOf(AccessDeniedException.class);
  }
}
