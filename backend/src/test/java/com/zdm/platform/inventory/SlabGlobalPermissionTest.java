package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.PermissionGuard;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

class SlabGlobalPermissionTest {
  private final SlabInventoryService service = mock(SlabInventoryService.class);
  private SlabInventoryController controller(String... permissions) {
    var provider = mock(CurrentIdentityProvider.class);
    when(provider.require()).thenReturn(new CurrentIdentity(1L, 1L, 1L, 1L, "supply-chain", null, null,
        "受限员工", "all", List.of("OPERATOR"), java.util.Arrays.stream(permissions)
            .map(p -> "supply-chain.slab-management." + p).toList()));
    return new SlabInventoryController(service, new PermissionGuard(provider), null, null);
  }
  private SlabInventory product(String status) {
    var product = new SlabInventory(); product.setStatus(status); product.setSourceStatus(status); return product;
  }
  @Test void publishingRequiresGlobalGrantAndExplicitShelfForBothPublisherTypes() {
    var warehouse = product("warehouse");
    controller("publish").create(warehouse);
    verify(service).createWithPrices(warehouse);
    assertThatThrownBy(() -> controller("warehouse.view").create(warehouse)).isInstanceOf(AccessDeniedException.class);
    for (String publisher : List.of("平台发布", "接口获取")) {
      var selling = product("selling"); selling.setPublisherType(publisher);
      assertThatThrownBy(() -> controller("publish").create(selling)).isInstanceOf(AccessDeniedException.class);
      controller("publish", "warehouse.shelf").create(selling);
      verify(service).createWithPrices(selling);
    }
  }
  @Test void editingPreservesSellingAndDoesNotImplicitlyAuthorizeTransition() {
    when(service.getById(1L)).thenReturn(product("selling"));
    var selling = product("selling");
    controller("selling.edit").update(1L, selling);
    verify(service).updateWithPrices(1L, selling);
    assertThatThrownBy(() -> controller("publish").update(1L, selling)).isInstanceOf(AccessDeniedException.class);
    assertThatThrownBy(() -> controller("selling.edit").update(1L, product("warehouse"))).isInstanceOf(AccessDeniedException.class);
    when(service.getById(1L)).thenReturn(product("warehouse"));
    assertThatThrownBy(() -> controller("warehouse.edit", "edit").update(1L, selling)).isInstanceOf(AccessDeniedException.class);
    controller("warehouse.edit", "warehouse.shelf").update(1L, selling);
    verify(service, times(2)).updateWithPrices(1L, selling);
  }
}
