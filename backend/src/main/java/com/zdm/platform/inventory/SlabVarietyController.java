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
@RequestMapping("/api/admin/slab-varieties")
public class SlabVarietyController extends AdminCrudController<SlabVariety> {
  private static final String PERMISSION_PREFIX = "admin.product-data-center.slab-variety";

  private final SlabVarietyService service;
  private final PermissionGuard permissionGuard;

  public SlabVarietyController(SlabVarietyService service, PermissionGuard permissionGuard) {
    super(service, permissionGuard, PERMISSION_PREFIX);
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @Override
  @GetMapping
  public ApiResponse<List<SlabVariety>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(service.list());
  }

  @Override
  @PostMapping
  public ApiResponse<SlabVariety> create(@Valid @RequestBody SlabVariety variety) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    return ApiResponse.ok(service.createVariety(variety));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<SlabVariety> update(
      @PathVariable Long id,
      @Valid @RequestBody SlabVariety payload) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    SlabVariety updated = service.updateVariety(id, payload);
    if (updated == null) {
      throw new IllegalArgumentException("品种不存在");
    }
    return ApiResponse.ok(updated);
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<SlabVariety> updateStatus(
      @PathVariable Long id,
      @Valid @RequestBody SlabVarietyStatusRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".toggle-status");
    SlabVariety updated = service.updateStatus(id, request.status());
    if (updated == null) {
      throw new IllegalArgumentException("品种不存在");
    }
    return ApiResponse.ok(updated);
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    return ApiResponse.ok(service.deleteVariety(id));
  }
}
