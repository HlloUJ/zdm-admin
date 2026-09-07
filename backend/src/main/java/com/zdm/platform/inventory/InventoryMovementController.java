package com.zdm.platform.inventory;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/inventory-movements")
public class InventoryMovementController {
  private static final String PERMISSION_PREFIX = "admin.finished-stock-management";
  private final InventoryMovementService service;
  private final PermissionGuard permissionGuard;

  public InventoryMovementController(InventoryMovementService service, PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<InventoryMovement>> list(@RequestParam Long inventoryId) {
    permissionGuard.requireView(PERMISSION_PREFIX);
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.listFinishedProductMovements(inventoryId));
  }

  @PostMapping
  public ApiResponse<InventoryMovement> create(@Valid @RequestBody InventoryMovement movement) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.createFinishedProductMovement(movement));
  }
}
