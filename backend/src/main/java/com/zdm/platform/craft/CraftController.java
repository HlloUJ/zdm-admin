package com.zdm.platform.craft;

import com.zdm.platform.common.AdminCrudController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/crafts")
public class CraftController extends AdminCrudController<Craft> {
  public CraftController(CraftService service) {
    super(service);
  }
}
