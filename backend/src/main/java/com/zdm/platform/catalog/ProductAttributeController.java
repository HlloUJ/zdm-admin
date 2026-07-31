package com.zdm.platform.catalog;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.security.PermissionGuard;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/product-attributes")
public class ProductAttributeController extends AdminCrudController<ProductAttribute> {
  public ProductAttributeController(ProductAttributeService service, PermissionGuard permissionGuard) {
    super(service, permissionGuard, "admin.product-data-center.attribute");
  }
}
