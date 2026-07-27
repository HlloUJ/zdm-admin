package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/finished-products")
public class FinishedProductController extends AdminCrudController<FinishedProduct> {
  public FinishedProductController(FinishedProductService service) {
    super(service);
  }
}
