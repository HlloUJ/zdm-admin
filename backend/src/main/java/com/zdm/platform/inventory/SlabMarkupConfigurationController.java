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
@RequestMapping("/api/admin/slab-markup-configurations")
public class SlabMarkupConfigurationController {
  private static final String PREFIX = "admin.product-data-center.markup-configuration";

  private final SlabMarkupConfigurationService service;
  private final PermissionGuard permissionGuard;

  public SlabMarkupConfigurationController(
      SlabMarkupConfigurationService service,
      PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<SlabMarkupConfiguration>> list() {
    permissionGuard.requirePermission(permission("view"));
    return ApiResponse.ok(service.listConfigurations(false));
  }

  @GetMapping("/options")
  public ApiResponse<List<SlabMarkupConfiguration>> options() {
    permissionGuard.requireAnyPermission(permission("view"), "admin.slab-management.view",
        "admin.slab-management.create", "admin.slab-management.edit");
    return ApiResponse.ok(service.listConfigurations(true));
  }

  @PostMapping
  public ApiResponse<SlabMarkupConfiguration> create(@Valid @RequestBody SlabMarkupConfiguration payload) {
    permissionGuard.requirePermission(permission("create"));
    return ApiResponse.ok(service.createConfiguration(payload));
  }

  @PutMapping("/{id}")
  public ApiResponse<SlabMarkupConfiguration> update(
      @PathVariable Long id,
      @Valid @RequestBody SlabMarkupConfiguration payload) {
    permissionGuard.requirePermission(permission("edit"));
    return ApiResponse.ok(service.updateConfiguration(id, payload));
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<SlabMarkupConfiguration> updateStatus(
      @PathVariable Long id,
      @Valid @RequestBody SlabMarkupConfigurationStatusRequest request) {
    permissionGuard.requirePermission(permission("toggle-status"));
    return ApiResponse.ok(service.updateStatus(id, request.status()));
  }

  @PatchMapping("/reorder")
  public ApiResponse<List<SlabMarkupConfiguration>> reorder(
      @Valid @RequestBody SlabMarkupConfigurationReorderRequest request) {
    permissionGuard.requirePermission(permission("sort"));
    return ApiResponse.ok(service.reorderConfigurations(request.orderedIds()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(permission("delete"));
    service.deleteConfiguration(id);
    return ApiResponse.ok(true);
  }

  private String permission(String action) {
    return PREFIX + ".slab." + action;
  }
}
