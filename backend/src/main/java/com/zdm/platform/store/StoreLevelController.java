package com.zdm.platform.store;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/store-levels")
public class StoreLevelController {
  private static final String PERMISSION_PREFIX = "admin.tenant.store-level-management";

  private final StoreLevelService service;
  private final PermissionGuard permissionGuard;

  public StoreLevelController(StoreLevelService service, PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<StoreLevel>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(service.list());
  }

  @PostMapping
  public ApiResponse<StoreLevel> create(@Valid @RequestBody StoreLevel level) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    return ApiResponse.ok(service.createLevel(level));
  }

  @PutMapping("/{id}")
  public ApiResponse<StoreLevel> update(
      @PathVariable Long id, @Valid @RequestBody StoreLevel payload) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    StoreLevel updated = service.updateLevel(id, payload);
    if (updated == null) {
      throw new IllegalArgumentException("店铺级别不存在");
    }
    return ApiResponse.ok(updated);
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<StoreLevel> updateStatus(
      @PathVariable Long id, @Valid @RequestBody StoreLevelStatusRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".toggle-status");
    StoreLevel updated = service.updateStatus(id, request.status());
    if (updated == null) {
      throw new IllegalArgumentException("店铺级别不存在");
    }
    return ApiResponse.ok(updated);
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    return ApiResponse.ok(service.deleteLevel(id));
  }

  @GetMapping("/{id}/delete-preview")
  public ApiResponse<Boolean> previewDelete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    return ApiResponse.ok(service.previewDelete(id));
  }
}
