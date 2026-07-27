package com.zdm.platform.supplier;

import com.zdm.platform.common.AdminCrudController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/suppliers")
public class SupplierController extends AdminCrudController<Supplier> {
  public SupplierController(SupplierService service) {
    super(service);
  }
}
