package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
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
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.deleteVariety(id));
  }
}
