package com.zdm.platform.catalog;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.ArrayList;
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
    List<String> visibleScopes = new ArrayList<>();
    for (String scope : List.of("shared", "finished", "accessory")) {
      if (permissionGuard.hasPermission(scopePermissionPrefix(scope) + ".view")) {
        visibleScopes.add(scope);
      }
    }
    return ApiResponse.ok(service.listWithTemplateCounts(visibleScopes));
  }

  @PostMapping
  public ApiResponse<ProductAttribute> create(@Valid @RequestBody ProductAttribute attribute) {
    requireAttributePermission(attribute.getScope(), "create");
    return ApiResponse.ok(service.createAttribute(attribute));
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<ProductAttribute> updateStatus(
      @PathVariable Long id,
      @Valid @RequestBody ProductAttributeStatusRequest request) {
    ProductAttribute existing = requireAttribute(id);
    requireAttributePermission(existing.getScope(), "toggle-status");
    return ApiResponse.ok(service.updateStatus(id, request.status()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    ProductAttribute existing = requireAttribute(id);
    requireAttributePermission(existing.getScope(), "delete");
    return ApiResponse.ok(service.deleteAttribute(id));
  }

  private ProductAttribute requireAttribute(Long id) {
    ProductAttribute attribute = service.getById(id);
    if (attribute == null) {
      throw new IllegalArgumentException("属性不存在或已被删除");
    }
    return attribute;
  }

  private void requireAttributePermission(String scope, String operation) {
    permissionGuard.requirePermission(scopePermissionPrefix(scope) + "." + operation);
  }

  private String scopePermissionPrefix(String scope) {
    if (!List.of("shared", "finished", "accessory").contains(scope)) {
      throw new IllegalArgumentException("属性类型无效");
    }
    return PERMISSION_PREFIX + "." + scope;
  }
}
