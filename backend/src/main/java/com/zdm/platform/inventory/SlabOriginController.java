package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
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
@RequestMapping("/api/admin/slab-origins")
public class SlabOriginController extends AdminCrudController<SlabOrigin> {
  private static final String PERMISSION_PREFIX = "admin.product-data-center.slab-origin";

  private final SlabOriginService service;
  private final PermissionGuard permissionGuard;

  public SlabOriginController(SlabOriginService service, PermissionGuard permissionGuard) {
    super(service, permissionGuard, PERMISSION_PREFIX);
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @Override
  @GetMapping
  public ApiResponse<List<SlabOrigin>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(service.list());
  }

  @Override
  @PostMapping
  public ApiResponse<SlabOrigin> create(@Valid @RequestBody SlabOrigin origin) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    return ApiResponse.ok(service.createOrigin(origin));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<SlabOrigin> update(
      @PathVariable Long id,
      @Valid @RequestBody SlabOrigin payload) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    SlabOrigin updated = service.updateOrigin(id, payload);
    if (updated == null) {
      throw new IllegalArgumentException("产地不存在");
    }
    return ApiResponse.ok(updated);
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<SlabOrigin> updateStatus(
      @PathVariable Long id,
      @Valid @RequestBody SlabOriginStatusRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".toggle-status");
    SlabOrigin updated = service.updateStatus(id, request.status());
    if (updated == null) {
      throw new IllegalArgumentException("产地不存在");
    }
    return ApiResponse.ok(updated);
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    return ApiResponse.ok(service.deleteOrigin(id));
  }
}
