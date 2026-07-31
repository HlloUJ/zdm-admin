package com.zdm.platform.craft;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.security.PermissionGuard;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/crafts")
public class CraftController extends AdminCrudController<Craft> {
  public CraftController(CraftService service, PermissionGuard permissionGuard) {
    super(service, permissionGuard, "admin.product-data-center.finished-stock-craft");
  }
}
