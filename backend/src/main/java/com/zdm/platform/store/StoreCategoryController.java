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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/store-categories")
public class StoreCategoryController {
  private static final String PERMISSION_PREFIX = "admin.tenant.store-category-management";

  private final StoreCategoryService service;
  private final PermissionGuard permissionGuard;

  public StoreCategoryController(StoreCategoryService service, PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<StoreCategory>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(service.listOrdered());
  }

  @PostMapping
  public ApiResponse<StoreCategory> create(@Valid @RequestBody StoreCategoryCreateRequest request) {
    String operation = request.parentId() == null ? "create-root" : "create-child";
    permissionGuard.requirePermission(PERMISSION_PREFIX + "." + operation);
    return ApiResponse.ok(service.createCategory(request));
  }

  @PutMapping("/{id}")
  public ApiResponse<StoreCategory> update(
      @PathVariable Long id,
      @Valid @RequestBody StoreCategoryUpdateRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    return ApiResponse.ok(service.updateCategory(id, request));
  }

  @PutMapping("/{id}/status")
  public ApiResponse<StoreCategory> updateStatus(
      @PathVariable Long id,
      @Valid @RequestBody StoreCategoryStatusRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".toggle-status");
    return ApiResponse.ok(service.updateStatus(id, request.status()));
  }

  @PutMapping("/{id}/move")
  public ApiResponse<StoreCategory> move(
      @PathVariable Long id,
      @Valid @RequestBody StoreCategoryMoveRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".move-" + request.direction());
    return ApiResponse.ok(service.moveCategory(id, request.direction()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    service.deleteCategory(id);
    return ApiResponse.ok(true);
  }
}
