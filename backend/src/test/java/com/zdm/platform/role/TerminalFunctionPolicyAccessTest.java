package com.zdm.platform.role;

import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.PermissionGuard;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class TerminalFunctionPolicyAccessTest {
  @Test
  void rejectsLegacyGrantsAllPermissionsAndNonPlatformSuperAdministrators() {
    var provider = mock(CurrentIdentityProvider.class);
    var service = new TerminalFunctionPolicyService(new PermissionGuard(provider));
    for (var identity : List.of(
        identity("admin", null, null, List.of("ADMIN_MANAGER")),
        identity("supply-chain", null, null, List.of("SUPER_ADMIN")),
        identity("admin", 1L, null, List.of("SUPER_ADMIN")),
        identity("admin", 1L, 2L, List.of("SUPER_ADMIN")))) {
      when(provider.require()).thenReturn(identity);
      assertThatThrownBy(service::listPolicies).isInstanceOf(AccessDeniedException.class);
      assertThatThrownBy(() -> service.savePolicy("store", ""))
          .isInstanceOf(AccessDeniedException.class);
    }
  }

  private CurrentIdentity identity(String client, Long tenant, Long store, List<String> roles) {
    return new CurrentIdentity(1L, 1L, 1L, null, client, tenant, store, "测试", "all", roles,
        List.of("all", "admin.permission-management.terminal-function-allocation.view",
            "admin.permission-management.terminal-function-allocation.save"));
  }
}
