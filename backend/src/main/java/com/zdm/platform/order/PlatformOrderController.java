package com.zdm.platform.order;

import com.zdm.platform.common.AdminCrudController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/orders")
public class PlatformOrderController extends AdminCrudController<PlatformOrder> {
  public PlatformOrderController(PlatformOrderService service) {
    super(service);
  }
}
