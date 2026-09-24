package com.zdm.platform.inventory;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
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
@RequestMapping("/api/admin/store-finished-price-configurations")
public class StoreFinishedPriceConfigurationController {
  public record SaveRequest(@NotNull Long roleId, @NotNull BigDecimal priceCoefficient) {}
  public record StatusRequest(@NotNull String status) {}

  private static final String PREFIX = "store.price-configuration";
  private final StoreFinishedPriceConfigurationService service;
  private final PermissionGuard guard;

  public StoreFinishedPriceConfigurationController(StoreFinishedPriceConfigurationService service,
      PermissionGuard guard) {
    this.service = service;
    this.guard = guard;
  }

  @GetMapping
  public ApiResponse<List<StoreFinishedPriceConfigurationService.Configuration>> list() {
    guard.requirePermission(PREFIX + ".view");
    guard.requireDataPermission();
    return ApiResponse.ok(service.list());
  }

  @GetMapping("/roles")
  public ApiResponse<List<StoreFinishedPriceConfigurationService.RoleOption>> roles() {
    guard.requireView(PREFIX);
    guard.requireDataPermission();
    return ApiResponse.ok(service.roles());
  }

  @PostMapping
  public ApiResponse<StoreFinishedPriceConfigurationService.Configuration> create(
      @Valid @RequestBody SaveRequest request) {
    guard.requirePermission(PREFIX + ".create");
    guard.requireDataPermission();
    return ApiResponse.ok(service.create(request.roleId(), request.priceCoefficient()));
  }

  @PutMapping("/{id}")
  public ApiResponse<StoreFinishedPriceConfigurationService.Configuration> update(@PathVariable Long id,
      @Valid @RequestBody SaveRequest request) {
    guard.requirePermission(PREFIX + ".edit");
    guard.requireDataPermission();
    return ApiResponse.ok(service.update(id, request.priceCoefficient()));
  }

  @PutMapping("/{id}/status")
  public ApiResponse<StoreFinishedPriceConfigurationService.Configuration> status(@PathVariable Long id,
      @Valid @RequestBody StatusRequest request) {
    guard.requirePermission(PREFIX + ".toggle-status");
    guard.requireDataPermission();
    return ApiResponse.ok(service.setStatus(id, request.status()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    guard.requirePermission(PREFIX + ".delete");
    guard.requireDataPermission();
    service.delete(id);
    return ApiResponse.ok(true);
  }
}
