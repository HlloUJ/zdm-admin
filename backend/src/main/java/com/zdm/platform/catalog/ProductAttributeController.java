package com.zdm.platform.catalog;

import com.zdm.platform.common.AdminCrudController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/product-attributes")
public class ProductAttributeController extends AdminCrudController<ProductAttribute> {
  public ProductAttributeController(ProductAttributeService service) {
    super(service);
  }
}
