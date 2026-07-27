package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/inventory-movements")
public class InventoryMovementController extends AdminCrudController<InventoryMovement> {
  public InventoryMovementController(InventoryMovementService service) {
    super(service);
  }
}
