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
@RequestMapping("/api/admin/product-attribute-values")
public class ProductAttributeValueController {
  private static final String PERMISSION_PREFIX = "admin.product-data-center.attribute-value";

  private final ProductAttributeValueService service;
  private final ProductAttributeService attributeService;
  private final PermissionGuard permissionGuard;

  public ProductAttributeValueController(
      ProductAttributeValueService service,
      ProductAttributeService attributeService,
      PermissionGuard permissionGuard) {
    this.service = service;
    this.attributeService = attributeService;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<ProductAttributeValue>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(service.listByScopes(visibleScopes()));
  }

  @GetMapping("/attribute-options")
  public ApiResponse<List<ProductAttribute>> listAttributeOptions() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(attributeService.listWithTemplateCounts(visibleScopes()).stream()
        .filter(attribute -> "select".equals(attribute.getValueType()))
        .toList());
  }

  @PostMapping
  public ApiResponse<ProductAttributeValue> create(
      @Valid @RequestBody ProductAttributeValue value) {
    ProductAttribute attribute = requireAttribute(value.getAttributeId());
    if (!attribute.getScope().equals(value.getScope()) || !"select".equals(attribute.getValueType())) {
      throw new IllegalArgumentException("所属属性与属性值类型不匹配");
    }
    if (!"enabled".equals(attribute.getStatus())) {
      throw new IllegalArgumentException("所属属性已停用");
    }
    requireValuePermission(value.getScope(), "create");
    return ApiResponse.ok(service.createValue(value));
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<ProductAttributeValue> updateStatus(
      @PathVariable Long id,
      @Valid @RequestBody ProductAttributeStatusRequest request) {
    ProductAttributeValue existing = requireValue(id);
    requireValuePermission(existing.getScope(), "toggle-status");
    return ApiResponse.ok(service.updateStatus(id, request.status()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    ProductAttributeValue existing = requireValue(id);
    requireValuePermission(existing.getScope(), "delete");
    return ApiResponse.ok(service.removeById(id));
  }

  private List<String> visibleScopes() {
    List<String> scopes = new ArrayList<>();
    for (String scope : List.of("shared", "finished", "accessory")) {
      if (permissionGuard.hasPermission(scopePermissionPrefix(scope) + ".view")) {
        scopes.add(scope);
      }
    }
    return scopes;
  }

  private ProductAttribute requireAttribute(Long id) {
    ProductAttribute attribute = attributeService.getById(id);
    if (attribute == null) {
      throw new IllegalArgumentException("所属属性不存在或已被删除");
    }
    return attribute;
  }

  private ProductAttributeValue requireValue(Long id) {
    ProductAttributeValue value = service.getById(id);
    if (value == null) {
      throw new IllegalArgumentException("属性值不存在或已被删除");
    }
    return value;
  }

  private void requireValuePermission(String scope, String operation) {
    permissionGuard.requirePermission(scopePermissionPrefix(scope) + "." + operation);
  }

  private String scopePermissionPrefix(String scope) {
    if (!List.of("shared", "finished", "accessory").contains(scope)) {
      throw new IllegalArgumentException("属性值类型无效");
    }
    return PERMISSION_PREFIX + "." + scope;
  }
}
