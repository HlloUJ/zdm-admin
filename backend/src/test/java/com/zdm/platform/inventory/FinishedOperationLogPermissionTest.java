package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.PermissionGuard;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

class FinishedOperationLogPermissionTest {
  @Test
  void listAndDetailRejectMissingFunctionPermission() {
    for (boolean hasPermission : List.of(false)) {
      CurrentIdentityProvider identities = mock(CurrentIdentityProvider.class);
      when(identities.require()).thenReturn(new CurrentIdentity(2L, 2L, 2L, 2L, "admin", 1L, 1L,
          "测试员工", hasPermission ? "self" : "all", List.of("ADMIN_MANAGER"),
          hasPermission ? List.of("admin.finished-stock-management.operation-log.view") : List.of("admin.finished-stock-management.view")));
      FinishedOperationLogService logs = mock(FinishedOperationLogService.class);
      FinishedProductController controller = new FinishedProductController(mock(FinishedProductService.class), logs,
          new PermissionGuard(identities), null, null);
      assertThatThrownBy(() -> controller.operationLogs(null, null, null, null, null, 1, 10)).isInstanceOf(AccessDeniedException.class);
      assertThatThrownBy(() -> controller.operationLogDetail(1L)).isInstanceOf(AccessDeniedException.class);
      verifyNoInteractions(logs);
    }
  }
}
