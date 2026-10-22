package com.zdm.platform.inventory;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/accessory-markup-configurations")
public class AccessoryMarkupConfigurationController {
  private static final String PREFIX = "admin.product-data-center.markup-configuration.accessory";
  private final AccessoryMarkupConfigurationService service;
  private final PermissionGuard permissionGuard;

  public AccessoryMarkupConfigurationController(AccessoryMarkupConfigurationService service,
      PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<AccessoryMarkupConfiguration>> list() {
    permissionGuard.requirePermission(permission("view"));
    return ApiResponse.ok(permissionGuard.filterData(service.listConfigurations(false)));
  }

  @GetMapping("/options")
  public ApiResponse<List<AccessoryMarkupConfiguration>> options() {
    if (!permissionGuard.hasView("admin.accessory-management")) {
      permissionGuard.requireAnyPermission(permission("view"), "admin.accessory-management.create",
          "admin.accessory-management.edit");
    }
    return ApiResponse.ok(permissionGuard.filterData(service.listConfigurations(true)));
  }

  @PostMapping
  public ApiResponse<AccessoryMarkupConfiguration> create(
      @Valid @RequestBody AccessoryMarkupConfiguration payload) {
    permissionGuard.requirePermission(permission("create"));
    return ApiResponse.ok(service.createConfiguration(payload));
  }

  @PutMapping("/{id}")
  public ApiResponse<AccessoryMarkupConfiguration> update(@PathVariable Long id,
      @Valid @RequestBody AccessoryMarkupConfiguration payload) {
    permissionGuard.requirePermission(permission("edit"));
    return ApiResponse.ok(service.updateConfiguration(id, payload));
  }

  @PatchMapping("/reorder")
  public ApiResponse<List<AccessoryMarkupConfiguration>> reorder(
      @Valid @RequestBody AccessoryMarkupConfigurationReorderRequest request) {
    permissionGuard.requirePermission(permission("sort"));
    return ApiResponse.ok(permissionGuard.filterData(service.reorderConfigurations(request.orderedIds())));
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<AccessoryMarkupConfiguration> updateStatus(
      @PathVariable Long id,
      @Valid @RequestBody AccessoryMarkupConfigurationStatusRequest request) {
    permissionGuard.requirePermission(permission("toggle-status"));
    return ApiResponse.ok(service.updateStatus(id, request.status()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(permission("delete"));
    service.deleteConfiguration(id);
    return ApiResponse.ok(true);
  }

  private String permission(String action) { return PREFIX + "." + action; }
}
