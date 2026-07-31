package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.security.PermissionGuard;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/inventory-movements")
public class InventoryMovementController extends AdminCrudController<InventoryMovement> {
  public InventoryMovementController(InventoryMovementService service, PermissionGuard permissionGuard) {
    super(service, permissionGuard, "admin.finished-stock-management");
  }
}
