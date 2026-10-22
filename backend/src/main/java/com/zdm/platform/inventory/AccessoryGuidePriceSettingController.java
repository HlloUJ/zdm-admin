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
@RequestMapping("/api/admin/accessory-guide-price-setting")
public class AccessoryGuidePriceSettingController {
  private static final String PREFIX = "admin.product-data-center.markup-configuration.accessory";
  private final AccessoryGuidePriceSettingService service;
  private final PermissionGuard permissionGuard;

  public AccessoryGuidePriceSettingController(
      AccessoryGuidePriceSettingService service,
      PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<AccessoryGuidePriceSetting> get() {
    if (!permissionGuard.hasView("admin.accessory-management")) {
      permissionGuard.requirePermission(PREFIX + ".view");
    }
    return ApiResponse.ok(service.getSetting());
  }

  @PutMapping
  public ApiResponse<AccessoryGuidePriceSetting> update(
      @Valid @RequestBody GuidePriceCoefficientRequest request) {
    permissionGuard.requirePermission(PREFIX + ".guide-price.edit");
    return ApiResponse.ok(service.saveSetting(request.priceCoefficient()));
  }
}
