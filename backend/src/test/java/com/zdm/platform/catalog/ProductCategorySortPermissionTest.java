package com.zdm.platform.catalog;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.zdm.platform.common.FunctionPermissionNormalizer;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.PermissionGuard;
import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.access.AccessDeniedException;

class ProductCategorySortPermissionTest {
  @ParameterizedTest
  @ValueSource(strings = {"sort", "move-up", "move-down", "edit", "accessory-sort"})
  void sortingRequiresSameScopeSortAndPreservesLegacyGrants(String action) {
    ProductCategoryService service = mock(ProductCategoryService.class);
    ProductCategory existing = category(1);
    ProductCategory reordered = category(2);
    when(service.getById(1L)).thenReturn(existing);
    CurrentIdentityProvider identity = mock(CurrentIdentityProvider.class);
    String permission = action.equals("accessory-sort")
        ? "admin.product-data-center.category.accessory.sort"
        : "admin.product-data-center.category.finished." + action;
    when(identity.require()).thenReturn(new CurrentIdentity(1L, 1L, 1L, 1L, "admin", null, null,
        "测试", "all", List.of(), FunctionPermissionNormalizer.normalize(List.of(permission))));
    ProductCategoryController controller = new ProductCategoryController(service, new PermissionGuard(identity));
    if (action.equals("edit") || action.equals("accessory-sort")) {
      assertThatThrownBy(() -> controller.update(1L, reordered)).isInstanceOf(AccessDeniedException.class);
      org.mockito.Mockito.verify(service, org.mockito.Mockito.never()).updateCategory(1L, reordered);
    } else {
      controller.update(1L, reordered);
      verify(service).updateCategory(1L, reordered);
    }
  }

  private ProductCategory category(int order) {
    ProductCategory category = new ProductCategory();
    category.setId(1L);
    category.setName("分类");
    category.setScope("finished");
    category.setStatus("enabled");
    category.setSortOrder(order);
    return category;
  }
}
