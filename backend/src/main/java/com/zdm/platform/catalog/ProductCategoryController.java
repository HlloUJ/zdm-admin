package com.zdm.platform.catalog;

import com.zdm.platform.common.AdminCrudController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/product-categories")
public class ProductCategoryController extends AdminCrudController<ProductCategory> {
  public ProductCategoryController(ProductCategoryService service) {
    super(service);
  }
}
