package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.PermissionGuard;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

class FinishedProductPermissionTest {
  private final FinishedProductService service = mock(FinishedProductService.class);
  private FinishedProductController controller(String... permissions) {
    CurrentIdentityProvider identities = mock(CurrentIdentityProvider.class);
    when(identities.require()).thenReturn(new CurrentIdentity(2L, 2L, 2L, 2L, "admin", null, null,
        "测试员工", "all", List.of("ADMIN_MANAGER"), java.util.Arrays.stream(permissions).map(permission -> "admin.finished-stock-management." + permission).toList()));
    return new FinishedProductController(service, null, new PermissionGuard(identities), null, null);
  }
  private FinishedProduct product(String status) {
    FinishedProduct value = new FinishedProduct();
    value.setStatus(status);
    return value;
  }
  @Test void viewCannotEditOrPublish() {
    when(service.getById(1L)).thenReturn(product("warehouse"));
    assertThatThrownBy(() -> controller("warehouse.view").update(1L, product("warehouse"))).isInstanceOf(AccessDeniedException.class);
    assertThatThrownBy(() -> controller("warehouse.view").create(product("warehouse"))).isInstanceOf(AccessDeniedException.class);
    verify(service, never()).updateWithDetails(any(), any());
    verify(service, never()).updateOperationWithDetails(any(), any(), anyBoolean());
  }
  @Test void publishSupportsBothFormChoicesAndEditUsesSourceTab() {
    FinishedProduct request = product("selling");
    controller("selling.publish").create(request);
    verify(service).createWithDetails(request);
    controller("warehouse.publish").create(request);
    assertThatThrownBy(() -> controller("warehouse.view").create(request)).isInstanceOf(AccessDeniedException.class);
    when(service.getById(1L)).thenReturn(product("selling"));
    controller("selling.edit").update(1L, request);
    verify(service).updateWithDetails(1L, request);
    assertThatThrownBy(() -> controller("warehouse.edit").update(1L, request)).isInstanceOf(AccessDeniedException.class);
  }
  @Test void statusPermissionsUseRestrictedUpdateAndRejectOtherOperations() {
    for (String permission : List.of("warehouse.shelf", "warehouse.batch-shelf")) {
      reset(service);
      when(service.getById(1L)).thenReturn(product("warehouse"));
      FinishedProduct request = product("selling");
      controller(permission).update(1L, request);
      verify(service).updateOperationWithDetails(1L, request, false);
      verify(service, never()).updateWithDetails(any(), any());
      assertThatThrownBy(() -> controller(permission).update(1L, product("recycle"))).isInstanceOf(AccessDeniedException.class);
    }
  }
  @Test void priceCannotEditOtherFieldsOrChangeStatus() {
    when(service.getById(1L)).thenReturn(product("warehouse"));
    FinishedProduct request = product("warehouse");
    controller("warehouse.price").update(1L, request);
    verify(service).updateOperationWithDetails(1L, request, true);
    verify(service, never()).updateWithDetails(any(), any());
    assertThatThrownBy(() -> controller("warehouse.price").update(1L, product("selling"))).isInstanceOf(AccessDeniedException.class);
    when(service.getById(1L)).thenReturn(product("soldOut"));
    assertThatThrownBy(() -> controller("sold-out.price").update(1L, product("soldOut"))).isInstanceOf(AccessDeniedException.class);
  }
  @Test void recyclingAndPermanentDeletionRemainDistinct() {
    when(service.getById(1L)).thenReturn(product("recycle"));
    assertThatThrownBy(() -> controller("warehouse.delete").delete(1L)).isInstanceOf(AccessDeniedException.class);
    controller("recycle.purge").delete(1L);
    verify(service).removeById(1L);
  }
  @Test void editingAndShelvingTogetherPersistTheWholeAuthorizedForm() {
    when(service.getById(1L)).thenReturn(product("warehouse"));
    FinishedProduct request = product("selling");
    controller("warehouse.edit", "warehouse.shelf").update(1L, request);
    verify(service).updateWithDetails(1L, request);
    verify(service, never()).updateOperationWithDetails(any(), any(), anyBoolean());
    assertThatThrownBy(() -> controller("warehouse.edit").update(1L, request))
        .isInstanceOf(AccessDeniedException.class);
    assertThatThrownBy(() -> controller("warehouse.publish").create(product("recycle")))
        .isInstanceOf(AccessDeniedException.class);
  }

}
