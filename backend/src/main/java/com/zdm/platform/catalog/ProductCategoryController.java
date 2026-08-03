package com.zdm.platform.catalog;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/product-categories")
public class ProductCategoryController extends AdminCrudController<ProductCategory> {
  private static final String PERMISSION_PREFIX = "admin.product-data-center.category";

  private final ProductCategoryService service;
  private final PermissionGuard permissionGuard;

  public ProductCategoryController(ProductCategoryService service, PermissionGuard permissionGuard) {
    super(service, permissionGuard, PERMISSION_PREFIX);
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @Override
  @GetMapping
  public ApiResponse<List<ProductCategory>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.listNewestFirst());
  }

  @Override
  @PostMapping
  public ApiResponse<ProductCategory> create(@Valid @RequestBody ProductCategory category) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.createCategory(category));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<ProductCategory> update(
      @PathVariable Long id,
      @Valid @RequestBody ProductCategory category) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.updateCategory(id, category));
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    permissionGuard.requireAllData();
    service.deleteCategory(id);
    return ApiResponse.ok(true);
  }
}
