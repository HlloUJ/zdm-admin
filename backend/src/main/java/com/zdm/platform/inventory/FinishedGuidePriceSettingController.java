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
@RequestMapping("/api/admin/finished-guide-price-setting")
public class FinishedGuidePriceSettingController {
  private static final String PREFIX = "admin.product-data-center.markup-configuration.finished";
  private final FinishedGuidePriceSettingService service;
  private final PermissionGuard permissionGuard;

  public FinishedGuidePriceSettingController(
      FinishedGuidePriceSettingService service,
      PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<FinishedGuidePriceSetting> get() {
    permissionGuard.requireAnyPermission(PREFIX + ".view", "admin.finished-stock-management.view");
    return ApiResponse.ok(service.getSetting());
  }

  @PutMapping
  public ApiResponse<FinishedGuidePriceSetting> update(
      @Valid @RequestBody GuidePriceCoefficientRequest request) {
    permissionGuard.requirePermission(PREFIX + ".edit");
    return ApiResponse.ok(service.saveSetting(request.priceCoefficient()));
  }
}
