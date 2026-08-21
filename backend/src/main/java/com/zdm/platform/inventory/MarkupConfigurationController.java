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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/markup-configurations")
public class MarkupConfigurationController {
  private static final String PREFIX = "admin.product-data-center.markup-configuration";

  private final MarkupConfigurationService service;
  private final PermissionGuard permissionGuard;

  public MarkupConfigurationController(
      MarkupConfigurationService service,
      PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<MarkupConfiguration>> list(@RequestParam String productType) {
    permissionGuard.requirePermission(tabPermission(productType, "view"));
    return ApiResponse.ok(service.listConfigurations(productType, false));
  }

  @GetMapping("/options")
  public ApiResponse<List<MarkupConfiguration>> options(@RequestParam String productType) {
    MarkupProductType type = MarkupProductType.require(productType);
    if (type == MarkupProductType.FINISHED) {
      permissionGuard.requireAnyPermission(
          tabPermission(productType, "view"),
          "admin.finished-stock-management.view",
          "admin.finished-stock-management.create",
          "admin.finished-stock-management.edit");
    } else {
      permissionGuard.requireAnyPermission(
          tabPermission(productType, "view"),
          "admin.slab-management.view",
          "admin.slab-management.create",
          "admin.slab-management.edit");
    }
    return ApiResponse.ok(service.listConfigurations(productType, true));
  }

  @PostMapping
  public ApiResponse<MarkupConfiguration> create(@Valid @RequestBody MarkupConfiguration payload) {
    permissionGuard.requirePermission(tabPermission(payload.getProductType(), "create"));
    return ApiResponse.ok(service.createConfiguration(payload));
  }

  @PutMapping("/{id}")
  public ApiResponse<MarkupConfiguration> update(
      @PathVariable Long id,
      @RequestParam String productType,
      @Valid @RequestBody MarkupConfiguration payload) {
    permissionGuard.requirePermission(tabPermission(productType, "edit"));
    return ApiResponse.ok(service.updateConfiguration(id, productType, payload));
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<MarkupConfiguration> updateStatus(
      @PathVariable Long id,
      @RequestParam String productType,
      @Valid @RequestBody MarkupConfigurationStatusRequest request) {
    permissionGuard.requirePermission(tabPermission(productType, "toggle-status"));
    return ApiResponse.ok(service.updateStatus(id, productType, request.status()));
  }

  @PatchMapping("/reorder")
  public ApiResponse<List<MarkupConfiguration>> reorder(
      @Valid @RequestBody MarkupConfigurationReorderRequest request) {
    permissionGuard.requirePermission(tabPermission(request.productType(), "sort"));
    return ApiResponse.ok(service.reorderConfigurations(request.productType(), request.orderedIds()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id, @RequestParam String productType) {
    permissionGuard.requirePermission(tabPermission(productType, "delete"));
    service.deleteConfiguration(id, productType);
    return ApiResponse.ok(true);
  }

  private String tabPermission(String productType, String action) {
    return PREFIX + "." + MarkupProductType.require(productType).value() + "." + action;
  }
}
