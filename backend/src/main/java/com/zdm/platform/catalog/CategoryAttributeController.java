package com.zdm.platform.catalog;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
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
  @PostMapping
  public ApiResponse<CategoryAttribute> create(@Valid @RequestBody CategoryAttribute categoryAttribute) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.createCategoryAttribute(categoryAttribute));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<CategoryAttribute> update(
      @PathVariable Long id,
      @Valid @RequestBody CategoryAttribute categoryAttribute) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.updateCategoryAttribute(id, categoryAttribute));
  }
}
