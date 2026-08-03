package com.zdm.platform.catalog;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
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
    List<String> visibleScopes = new ArrayList<>();
    for (String scope : List.of("finished", "accessory")) {
      if (permissionGuard.hasPermission(scopePermissionPrefix(scope) + ".view")) {
        visibleScopes.add(scope);
      }
    }
    return ApiResponse.ok(service.listNewestFirst(visibleScopes));
  }

  @Override
  @PostMapping
  public ApiResponse<ProductCategory> create(@Valid @RequestBody ProductCategory category) {
    String operation = category.getParentId() == null ? "create-root" : "create-child";
    requireCategoryPermission(category.getScope(), operation);
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.createCategory(category));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<ProductCategory> update(
      @PathVariable Long id,
      @Valid @RequestBody ProductCategory category) {
    ProductCategory existing = requireCategory(id);
    if (!Objects.equals(existing.getScope(), category.getScope())) {
      throw new IllegalArgumentException("不能修改分类所属类型");
    }
    boolean operationDetected = false;
    if (!Objects.equals(existing.getName(), category.getName())
        || !Objects.equals(existing.getParentId(), category.getParentId())
        || !Objects.equals(existing.getProductCount(), category.getProductCount())) {
      requireCategoryPermission(existing.getScope(), "edit");
      operationDetected = true;
    }
    if (!Objects.equals(existing.getSortOrder(), category.getSortOrder())) {
      requireAnyCategoryPermission(existing.getScope(), List.of("move-up", "move-down"));
      operationDetected = true;
    }
    if (!Objects.equals(existing.getStatus(), category.getStatus())) {
      String operation = "enabled".equals(category.getStatus()) ? "enable" : "disable";
      requireCategoryPermission(existing.getScope(), operation);
      operationDetected = true;
    }
    if (!operationDetected) {
      requireCategoryPermission(existing.getScope(), "edit");
    }
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.updateCategory(id, category));
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    ProductCategory category = requireCategory(id);
    requireCategoryPermission(category.getScope(), "delete");
    permissionGuard.requireAllData();
    service.deleteCategory(id);
    return ApiResponse.ok(true);
  }

  private ProductCategory requireCategory(Long id) {
    ProductCategory category = service.getById(id);
    if (category == null) {
      throw new IllegalArgumentException("分类不存在或已被删除");
    }
    return category;
  }

  private void requireCategoryPermission(String scope, String operation) {
    permissionGuard.requirePermission(scopePermissionPrefix(scope) + "." + operation);
  }

  private void requireAnyCategoryPermission(
      String scope,
      List<String> operations) {
    List<String> permissions = new ArrayList<>();
    operations.forEach(operation -> permissions.add(scopePermissionPrefix(scope) + "." + operation));
    permissionGuard.requireAnyPermission(permissions.toArray(String[]::new));
  }

  private String scopePermissionPrefix(String scope) {
    if (!"finished".equals(scope) && !"accessory".equals(scope)) {
      throw new IllegalArgumentException("分类类型无效");
    }
    return PERMISSION_PREFIX + "." + scope;
  }
}
