package com.zdm.platform.supplier;

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
@RequestMapping("/api/admin/supplier-supply-types")
public class SupplierSupplyTypeController {
  private static final String PREFIX = "admin.supplier-management";
  private final SupplierSupplyTypeService service;
  private final PermissionGuard permissionGuard;

  public SupplierSupplyTypeController(
      SupplierSupplyTypeService service,
      PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<SupplierSupplyType>> list() {
    permissionGuard.requireView(PREFIX);
    return ApiResponse.ok(service.listTypes());
  }

  @PostMapping
  public ApiResponse<SupplierSupplyType> create(@Valid @RequestBody SupplierSupplyType type) {
    permissionGuard.requirePermission(PREFIX + ".manage-supply-types");
    return ApiResponse.ok(service.createType(type));
  }

  @PutMapping("/{id}")
  public ApiResponse<SupplierSupplyType> update(
      @PathVariable Long id,
      @Valid @RequestBody SupplierSupplyType type) {
    permissionGuard.requirePermission(PREFIX + ".manage-supply-types");
    return ApiResponse.ok(service.updateType(id, type));
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<SupplierSupplyType> updateStatus(
      @PathVariable Long id,
      @Valid @RequestBody SupplierStatusRequest request) {
    permissionGuard.requirePermission(PREFIX + ".manage-supply-types");
    return ApiResponse.ok(service.updateStatus(id, request.status()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PREFIX + ".manage-supply-types");
    service.deleteType(id);
    return ApiResponse.ok(true);
  }
}
