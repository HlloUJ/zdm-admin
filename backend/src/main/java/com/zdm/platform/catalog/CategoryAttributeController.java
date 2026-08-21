package com.zdm.platform.catalog;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Objects;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/category-attributes")
public class CategoryAttributeController extends AdminCrudController<CategoryAttribute> {
  private static final String PERMISSION_PREFIX = "admin.product-data-center.category-attribute-template";

  private final CategoryAttributeService service;
  private final ProductCategoryService categoryService;
  private final CategoryAttributeValueBindingService valueBindingService;
  private final PermissionGuard permissionGuard;

  public CategoryAttributeController(
      CategoryAttributeService service,
      ProductCategoryService categoryService,
      CategoryAttributeValueBindingService valueBindingService,
      PermissionGuard permissionGuard) {
    super(service, permissionGuard, PERMISSION_PREFIX);
    this.service = service;
    this.categoryService = categoryService;
    this.valueBindingService = valueBindingService;
    this.permissionGuard = permissionGuard;
  }

  @Override
  @GetMapping
  public ApiResponse<List<CategoryAttribute>> list() {
    permissionGuard.requireAnyPermission(
        PERMISSION_PREFIX + ".finished.view",
        PERMISSION_PREFIX + ".accessory.view",
        PERMISSION_PREFIX + ".view");
    return ApiResponse.ok(service.listWithOptionCounts());
  }

  @Override
  @PostMapping
  public ApiResponse<CategoryAttribute> create(@Valid @RequestBody CategoryAttribute categoryAttribute) {
    requireScopedPermission(categoryAttribute.getCategoryId(), "create", "create");
    return ApiResponse.ok(service.createCategoryAttribute(categoryAttribute));
  }

  @PostMapping("/batch")
  public ApiResponse<List<CategoryAttribute>> createBatch(
      @Valid @RequestBody CategoryAttributeBatchRequest request) {
    requireScopedPermission(request.categoryId(), "create", "create");
    return ApiResponse.ok(service.createCategoryAttributes(request));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<CategoryAttribute> update(
      @PathVariable Long id,
      @Valid @RequestBody CategoryAttribute categoryAttribute) {
    CategoryAttribute existing = getExisting(id);
    if (!Objects.equals(existing.getAttributeRole(), categoryAttribute.getAttributeRole())) {
      requireScopedPermission(existing.getCategoryId(), "attribute-role", "edit");
    }
    if (Boolean.TRUE.equals(existing.getRequiredFlag()) != Boolean.TRUE.equals(categoryAttribute.getRequiredFlag())) {
      requireScopedPermission(existing.getCategoryId(), "required", "edit");
    }
    boolean skuChanged = Boolean.TRUE.equals(existing.getSkuFlag()) != Boolean.TRUE.equals(categoryAttribute.getSkuFlag());
    boolean skuDisabledByRoleChange = skuChanged
        && Boolean.TRUE.equals(existing.getSkuFlag())
        && !Boolean.TRUE.equals(categoryAttribute.getSkuFlag())
        && !Objects.equals(existing.getAttributeRole(), categoryAttribute.getAttributeRole())
        && !"sales".equals(categoryAttribute.getAttributeRole());
    if (skuChanged && !skuDisabledByRoleChange) {
      requireScopedPermission(existing.getCategoryId(), "sku-combination", "edit");
    }
    if (!Objects.equals(existing.getSortOrder(), categoryAttribute.getSortOrder())
        || !Objects.equals(existing.getCategoryId(), categoryAttribute.getCategoryId())
        || !Objects.equals(existing.getAttributeId(), categoryAttribute.getAttributeId())) {
      requireScopedPermission(existing.getCategoryId(), "create", "edit");
    }
    return ApiResponse.ok(service.updateCategoryAttribute(id, categoryAttribute));
  }

  @PutMapping("/{id}/publish")
  public ApiResponse<CategoryAttribute> publish(@PathVariable Long id) {
    requireScopedPermission(getExisting(id).getCategoryId(), "toggle-publish", "toggle-publish");
    return ApiResponse.ok(service.updatePublishStatus(id, "published"));
  }

  @PutMapping("/{id}/unpublish")
  public ApiResponse<CategoryAttribute> unpublish(@PathVariable Long id) {
    requireScopedPermission(getExisting(id).getCategoryId(), "toggle-publish", "toggle-publish");
    return ApiResponse.ok(service.updatePublishStatus(id, "unpublished"));
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    requireScopedPermission(getExisting(id).getCategoryId(), "delete", "delete");
    return ApiResponse.ok(service.deleteCategoryAttribute(id));
  }

  @GetMapping("/{id}/values")
  public ApiResponse<List<CategoryAttributeValueOption>> listValueOptions(@PathVariable Long id) {
    CategoryAttribute existing = getExisting(id);
    requireScopedPermission(existing.getCategoryId(), "view", "view");
    return ApiResponse.ok(valueBindingService.listOptions(id));
  }

  @PutMapping("/{id}/values")
  public ApiResponse<List<CategoryAttributeValueOption>> replaceValueBindings(
      @PathVariable Long id,
      @Valid @RequestBody CategoryAttributeValueBindingRequest request) {
    CategoryAttribute existing = getExisting(id);
    requireScopedPermission(existing.getCategoryId(), "bind-values", "edit");
    service.requireCreator(id);
    return ApiResponse.ok(valueBindingService.replaceBindings(id, request));
  }

  private CategoryAttribute getExisting(Long id) {
    CategoryAttribute existing = service.getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("类目属性模板不存在");
    }
    return existing;
  }

  private void requireScopedPermission(Long categoryId, String action, String legacyAction) {
    ProductCategory category = categoryService.getById(categoryId);
    if (category == null || (!"finished".equals(category.getScope()) && !"accessory".equals(category.getScope()))) {
      throw new IllegalArgumentException("商品分类不存在");
    }
    permissionGuard.requireAnyPermission(
        PERMISSION_PREFIX + "." + category.getScope() + "." + action,
        PERMISSION_PREFIX + "." + legacyAction);
  }
}
