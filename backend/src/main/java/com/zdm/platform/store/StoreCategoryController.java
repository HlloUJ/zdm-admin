package com.zdm.platform.store;

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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/store-categories")
public class StoreCategoryController {
  private static final String PREFIX = "admin.tenant.store-category-management";
  private final StoreCategoryService service;
  private final PermissionGuard permissionGuard;

  public StoreCategoryController(StoreCategoryService service, PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  private String prefix(String scope) {
    if (!List.of("finished", "accessory").contains(scope)) {
      throw new IllegalArgumentException("分类类型不正确");
    }
    return PREFIX + "." + scope;
  }

  @GetMapping
  public ApiResponse<List<StoreCategory>> list(@RequestParam String scope) {
    permissionGuard.requireView(prefix(scope));
    return ApiResponse.ok(service.listOrdered(scope));
  }

  @GetMapping("/{id}/child-creation-check")
  public ApiResponse<Boolean> childCreationCheck(@PathVariable Long id, @RequestParam String scope) {
    permissionGuard.requirePermission(prefix(scope) + ".create-child");
    return ApiResponse.ok(service.hasPriceCoefficient(id, scope));
  }

  @PostMapping
  public ApiResponse<StoreCategory> create(@Valid @RequestBody StoreCategoryCreateRequest request) {
    String action = request.parentId() == null ? "create-root" : "create-child";
    permissionGuard.requirePermission(prefix(request.scope()) + "." + action);
    return ApiResponse.ok(service.createCategory(request));
  }

  @PutMapping("/{id}")
  public ApiResponse<StoreCategory> update(@PathVariable Long id, @RequestParam String scope,
      @Valid @RequestBody StoreCategoryUpdateRequest request) {
    permissionGuard.requirePermission(prefix(scope) + ".edit");
    StoreCategory category = service.requireCategory(id, scope);
    if (request.status() != null && !request.status().equals(category.getStatus())) {
      permissionGuard.requirePermission(prefix(scope) + ".toggle-status");
    }
    return ApiResponse.ok(service.updateCategory(id, scope, request));
  }

  @PutMapping("/{id}/status")
  public ApiResponse<StoreCategory> updateStatus(@PathVariable Long id, @RequestParam String scope,
      @Valid @RequestBody StoreCategoryStatusRequest request) {
    permissionGuard.requirePermission(prefix(scope) + ".toggle-status");
    return ApiResponse.ok(service.updateStatus(id, scope, request.status()));
  }

  @PutMapping("/sort")
  public ApiResponse<List<StoreCategory>> sort(@Valid @RequestBody StoreCategorySortRequest request) {
    permissionGuard.requirePermission(prefix(request.scope()) + ".sort");
    return ApiResponse.ok(service.sortCategories(request));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id, @RequestParam String scope) {
    permissionGuard.requirePermission(prefix(scope) + ".delete");
    service.deleteCategory(id, scope);
    return ApiResponse.ok(true);
  }
}
