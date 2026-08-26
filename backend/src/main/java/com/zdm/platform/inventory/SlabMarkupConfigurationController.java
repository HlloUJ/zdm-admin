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
    if (!permissionGuard.hasPermission(permission("view"))) {
      permissionGuard.requireView("admin.slab-management");
    }
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
