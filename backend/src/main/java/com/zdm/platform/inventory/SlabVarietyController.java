package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/slab-varieties")
public class SlabVarietyController extends AdminCrudController<SlabVariety> {
  public SlabVarietyController(SlabVarietyService service) {
    super(service);
  }
}
