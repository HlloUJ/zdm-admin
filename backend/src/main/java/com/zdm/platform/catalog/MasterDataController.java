package com.zdm.platform.catalog;

import com.zdm.platform.common.AdminCrudController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/master-data")
public class MasterDataController extends AdminCrudController<MasterData> {
  public MasterDataController(MasterDataService service) {
    super(service);
  }
}
