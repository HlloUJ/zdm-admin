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
@RequestMapping("/api/admin/category-attributes")
public class CategoryAttributeController extends AdminCrudController<CategoryAttribute> {
  private static final String PERMISSION_PREFIX = "admin.product-data-center.category-attribute-template";

  private final CategoryAttributeService service;
  private final PermissionGuard permissionGuard;

  public CategoryAttributeController(CategoryAttributeService service, PermissionGuard permissionGuard) {
    super(service, permissionGuard, PERMISSION_PREFIX);
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @Override
  @GetMapping
  public ApiResponse<List<CategoryAttribute>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(service.list());
  }

  @Override
  @PostMapping
  public ApiResponse<CategoryAttribute> create(@Valid @RequestBody CategoryAttribute categoryAttribute) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    return ApiResponse.ok(service.createCategoryAttribute(categoryAttribute));
  }

  @PostMapping("/batch")
  public ApiResponse<List<CategoryAttribute>> createBatch(
      @Valid @RequestBody CategoryAttributeBatchRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    return ApiResponse.ok(service.createCategoryAttributes(request));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<CategoryAttribute> update(
      @PathVariable Long id,
      @Valid @RequestBody CategoryAttribute categoryAttribute) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    return ApiResponse.ok(service.updateCategoryAttribute(id, categoryAttribute));
  }

  @PutMapping("/{id}/publish")
  public ApiResponse<CategoryAttribute> publish(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".toggle-publish");
    return ApiResponse.ok(service.updatePublishStatus(id, "published"));
  }

  @PutMapping("/{id}/unpublish")
  public ApiResponse<CategoryAttribute> unpublish(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".toggle-publish");
    return ApiResponse.ok(service.updatePublishStatus(id, "unpublished"));
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    return ApiResponse.ok(service.removeById(id));
  }
}
