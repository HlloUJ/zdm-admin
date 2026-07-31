package com.zdm.platform.supplier;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.security.PermissionGuard;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/suppliers")
public class SupplierController extends AdminCrudController<Supplier> {
  public SupplierController(SupplierService service, PermissionGuard permissionGuard) {
    super(service, permissionGuard, "admin.supplier-management");
  }
}
