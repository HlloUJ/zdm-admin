package com.zdm.platform.inventory;

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
@RequestMapping("/api/admin/finished-markup-configurations")
public class FinishedMarkupConfigurationController {
  private static final String PREFIX = "admin.product-data-center.markup-configuration.finished";
  private final FinishedMarkupConfigurationService service;
  private final PermissionGuard permissionGuard;

  public FinishedMarkupConfigurationController(FinishedMarkupConfigurationService service,
      PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<FinishedMarkupConfiguration>> list() {
    permissionGuard.requirePermission(permission("view"));
    return ApiResponse.ok(service.listConfigurations(false));
  }

  @GetMapping("/options")
  public ApiResponse<List<FinishedMarkupConfiguration>> options() {
    permissionGuard.requireAnyPermission(permission("view"), "admin.finished-stock-management.view",
        "admin.finished-stock-management.create", "admin.finished-stock-management.edit");
    return ApiResponse.ok(service.listConfigurations(true));
  }

  @PostMapping
  public ApiResponse<FinishedMarkupConfiguration> create(
      @Valid @RequestBody FinishedMarkupConfiguration payload) {
    permissionGuard.requirePermission(permission("create"));
    return ApiResponse.ok(service.createConfiguration(payload));
  }

  @PutMapping("/{id}")
  public ApiResponse<FinishedMarkupConfiguration> update(@PathVariable Long id,
      @Valid @RequestBody FinishedMarkupConfiguration payload) {
    permissionGuard.requirePermission(permission("edit"));
    return ApiResponse.ok(service.updateConfiguration(id, payload));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(permission("delete"));
    service.deleteConfiguration(id);
    return ApiResponse.ok(true);
  }

  private String permission(String action) { return PREFIX + "." + action; }
}
