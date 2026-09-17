package com.zdm.platform.inventory;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.common.ProductFormCatalogDirectory;
import com.zdm.platform.common.ProductFormSupplierDirectory;
import com.zdm.platform.security.PermissionGuard;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/finished-products")
public class FinishedProductOptionsController {
  private final ProductFormCatalogDirectory catalog;
  private final ProductFormSupplierDirectory suppliers;
  private final PermissionGuard guard;

  public FinishedProductOptionsController(ProductFormCatalogDirectory catalog,
      ProductFormSupplierDirectory suppliers, PermissionGuard guard) {
    this.catalog = catalog;
    this.suppliers = suppliers;
    this.guard = guard;
  }

  public record Options(List<ProductFormCatalogDirectory.Category> categories,
      List<ProductFormCatalogDirectory.Attribute> attributes,
      List<ProductFormSupplierDirectory.Supplier> suppliers) {
    public Options {
      categories = List.copyOf(categories);
      attributes = List.copyOf(attributes);
      suppliers = List.copyOf(suppliers);
    }
  }

  @GetMapping("/form-options")
  public ApiResponse<Options> options() {
    guard.requireView(("supply-chain".equals(guard.identity().clientCode())?"supply-chain.":"admin.")+"finished-stock-management");
    guard.requireDataPermission();
    return ApiResponse.ok(new Options(catalog.finishedCategories(), catalog.finishedAttributes(), suppliers.suppliers()));
  }
}
