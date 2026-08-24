package com.zdm.platform.inventory;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/slab-guide-price-setting")
public class SlabGuidePriceSettingController {
  private static final String PREFIX = "admin.product-data-center.markup-configuration.slab";
  private final SlabGuidePriceSettingService service;
  private final PermissionGuard permissionGuard;

  public SlabGuidePriceSettingController(
      SlabGuidePriceSettingService service,
      PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<SlabGuidePriceSetting> get() {
    if (!permissionGuard.hasPermission(PREFIX + ".view")) {
      permissionGuard.requireView("admin.slab-management");
    }
    return ApiResponse.ok(service.getSetting());
  }

  @PutMapping
  public ApiResponse<SlabGuidePriceSetting> update(
      @Valid @RequestBody GuidePriceCoefficientRequest request) {
    permissionGuard.requirePermission(PREFIX + ".edit");
    return ApiResponse.ok(service.saveSetting(request.priceCoefficient()));
  }
}
