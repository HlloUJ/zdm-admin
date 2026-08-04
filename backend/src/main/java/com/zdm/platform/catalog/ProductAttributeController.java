package com.zdm.platform.catalog;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/product-attributes")
public class ProductAttributeController {
  private static final String PERMISSION_PREFIX = "admin.product-data-center.attribute";

  private final ProductAttributeService service;
  private final PermissionGuard permissionGuard;

  public ProductAttributeController(ProductAttributeService service, PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<ProductAttribute>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(service.listWithTemplateCounts());
  }

  @PostMapping
  public ApiResponse<ProductAttribute> create(@Valid @RequestBody ProductAttribute attribute) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    return ApiResponse.ok(service.createAttribute(attribute));
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<ProductAttribute> updateStatus(
      @PathVariable Long id,
      @Valid @RequestBody ProductAttributeStatusRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".toggle-status");
    return ApiResponse.ok(service.updateStatus(id, request.status()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    return ApiResponse.ok(service.removeById(id));
  }
}
