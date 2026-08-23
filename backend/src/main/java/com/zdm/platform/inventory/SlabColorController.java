package com.zdm.platform.inventory;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/slab-colors")
public class SlabColorController {
  private static final String PREFIX = "admin.product-data-center.slab-color";
  private final SlabColorService service;
  private final PermissionGuard permissionGuard;

  public SlabColorController(SlabColorService service, PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<SlabColor>> list() {
    permissionGuard.requireView(PREFIX);
    return ApiResponse.ok(service.listColors());
  }

  @PostMapping
  public ApiResponse<SlabColor> create(@Valid @RequestBody SlabColor color) {
    permissionGuard.requirePermission(PREFIX + ".create");
    return ApiResponse.ok(service.createColor(color));
  }

  @PutMapping("/{id}")
  public ApiResponse<SlabColor> update(@PathVariable Long id, @Valid @RequestBody SlabColor color) {
    permissionGuard.requirePermission(PREFIX + ".edit");
    return ApiResponse.ok(service.updateColor(id, color));
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<SlabColor> updateStatus(
      @PathVariable Long id, @Valid @RequestBody SlabColorStatusRequest request) {
    permissionGuard.requirePermission(PREFIX + ".toggle-status");
    return ApiResponse.ok(service.updateStatus(id, request.status()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PREFIX + ".delete");
    return ApiResponse.ok(service.deleteColor(id));
  }

  @GetMapping("/categories")
  public ApiResponse<List<SlabColorCategory>> categories() {
    permissionGuard.requireView(PREFIX);
    return ApiResponse.ok(service.listCategories());
  }

  @PostMapping("/categories")
  public ApiResponse<SlabColorCategory> createCategory(@Valid @RequestBody SlabColorCategory category) {
    permissionGuard.requirePermission(PREFIX + ".manage-categories");
    return ApiResponse.ok(service.createCategory(category));
  }

  @PutMapping("/categories/{id}")
  public ApiResponse<SlabColorCategory> updateCategory(
      @PathVariable Long id, @Valid @RequestBody SlabColorCategory category) {
    permissionGuard.requirePermission(PREFIX + ".manage-categories");
    return ApiResponse.ok(service.updateCategory(id, category));
  }

  @DeleteMapping("/categories/{id}")
  public ApiResponse<Boolean> deleteCategory(@PathVariable Long id) {
    permissionGuard.requirePermission(PREFIX + ".manage-categories");
    return ApiResponse.ok(service.deleteCategory(id));
  }
}
