package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/slabs")
public class SlabInventoryController extends AdminCrudController<SlabInventory> {
  private static final String PERMISSION_PREFIX = "admin.slab-management";
  private final SlabInventoryService service;
  private final PermissionGuard permissionGuard;

  public SlabInventoryController(SlabInventoryService service, PermissionGuard permissionGuard) {
    super(service, permissionGuard, PERMISSION_PREFIX);
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping("/publish-options")
  public ApiResponse<SlabPublishOptions> publishOptions() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(service.listPublishOptions());
  }

  @Override
  @PostMapping
  public ApiResponse<SlabInventory> create(@Valid @RequestBody SlabInventory inventory) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    permissionGuard.requireAllData();
    service.validateReferences(inventory);
    inventory.setId(null);
    service.save(inventory);
    return ApiResponse.ok(inventory);
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<SlabInventory> update(
      @PathVariable Long id, @Valid @RequestBody SlabInventory inventory) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    permissionGuard.requireAllData();
    service.validateReferences(inventory);
    inventory.setId(id);
    service.updateById(inventory);
    return ApiResponse.ok(service.getById(id));
  }
}
