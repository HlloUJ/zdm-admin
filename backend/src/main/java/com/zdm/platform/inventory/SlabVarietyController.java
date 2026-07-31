package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.security.PermissionGuard;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/slab-varieties")
public class SlabVarietyController extends AdminCrudController<SlabVariety> {
  public SlabVarietyController(SlabVarietyService service, PermissionGuard permissionGuard) {
    super(service, permissionGuard, "admin.product-data-center.slab-variety");
  }
}
