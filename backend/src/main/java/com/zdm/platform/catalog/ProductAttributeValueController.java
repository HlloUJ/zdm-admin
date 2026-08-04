package com.zdm.platform.catalog;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/product-attribute-values")
public class ProductAttributeValueController
    extends AdminCrudController<ProductAttributeValue> {
  private static final String PERMISSION_PREFIX = "admin.product-data-center.attribute-value";

  private final ProductAttributeValueService service;
  private final PermissionGuard permissionGuard;

  public ProductAttributeValueController(ProductAttributeValueService service, PermissionGuard permissionGuard) {
    super(service, permissionGuard, PERMISSION_PREFIX);
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @Override
  @GetMapping
  public ApiResponse<List<ProductAttributeValue>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(service.list());
  }

  @Override
  @PostMapping
  public ApiResponse<ProductAttributeValue> create(
      @Valid @RequestBody ProductAttributeValue value) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    return ApiResponse.ok(service.createValue(value));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<ProductAttributeValue> update(
      @PathVariable Long id,
      @Valid @RequestBody ProductAttributeValue value) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    return ApiResponse.ok(service.updateValue(id, value));
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    return ApiResponse.ok(service.removeById(id));
  }
}
