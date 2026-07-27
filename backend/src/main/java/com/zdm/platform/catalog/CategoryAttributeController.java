package com.zdm.platform.catalog;

import com.zdm.platform.common.AdminCrudController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/category-attributes")
public class CategoryAttributeController extends AdminCrudController<CategoryAttribute> {
  public CategoryAttributeController(CategoryAttributeService service) {
    super(service);
  }
}
