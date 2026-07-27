package com.zdm.platform.catalog;

import com.zdm.platform.common.AdminCrudController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/product-attribute-values")
public class ProductAttributeValueController
    extends AdminCrudController<ProductAttributeValue> {
  public ProductAttributeValueController(ProductAttributeValueService service) {
    super(service);
  }
}
