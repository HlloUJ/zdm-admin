package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/slabs")
public class SlabInventoryController extends AdminCrudController<SlabInventory> {
  public SlabInventoryController(SlabInventoryService service) {
    super(service);
  }
}
