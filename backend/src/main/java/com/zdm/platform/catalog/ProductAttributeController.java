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
    List<String> scopes = visibleScopes();
    return ApiResponse.ok(permissionGuard.filterData(service.listWithTemplateCounts(scopes)));
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

  @GetMapping("/{id}/delete-preview")
  public ApiResponse<ProductAttributeDeletePreview> previewDelete(@PathVariable Long id) {
    ProductAttribute existing = requireAttribute(id);
    requireAttributePermission(existing.getScope(), "delete");
    return ApiResponse.ok(withAuthorizedTemplateMessage(service.previewDelete(id)));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<ProductAttributeDeleteResult> delete(@PathVariable Long id) {
    ProductAttribute existing = requireAttribute(id);
    requireAttributePermission(existing.getScope(), "delete");
    ProductAttributeDeletePreview preview = withAuthorizedTemplateMessage(service.previewDelete(id));
    if ("blocked".equals(preview.deletionMode())) {
      throw new IllegalArgumentException(preview.message());
    }
    return ApiResponse.ok(service.deleteAttribute(id));
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
    ProductAttribute attribute = service.getActiveById(id);
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

  private ProductAttributeDeletePreview withAuthorizedTemplateMessage(
      ProductAttributeDeletePreview preview) {
    if (preview.templateScopes().isEmpty()) {
      return preview;
    }
    boolean canViewEveryTemplate = preview.templateScopes().stream()
        .allMatch(scope -> permissionGuard.hasPermission(
            "admin.product-data-center.category-attribute-template." + scope + ".attributes.view"));
    if (!canViewEveryTemplate) {
      return preview.withMessage(
          "该属性已被分类属性模板使用，不能删除，请联系有权限的管理员处理。");
    }
    boolean finished = preview.templateScopes().contains("finished");
    boolean accessory = preview.templateScopes().contains("accessory");
    if (finished && accessory) {
      return preview.withMessage(
          "该属性已被分类属性模板使用，不能删除，请分别前往“分类属性模板-成品现货模板tab”和“分类属性模板-配件模板tab”移除该属性。");
    }
    String tabName = finished ? "成品现货模板tab" : "配件模板tab";
    return preview.withMessage(
        "该属性已被分类属性模板使用，不能删除，请先前往“分类属性模板-" + tabName + "”移除该属性。");
  }
}
