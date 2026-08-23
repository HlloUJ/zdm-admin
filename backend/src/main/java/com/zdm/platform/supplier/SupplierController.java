package com.zdm.platform.supplier;

import com.zdm.platform.common.AdminCrudController;
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
@RequestMapping("/api/admin/suppliers")
public class SupplierController extends AdminCrudController<Supplier> {
  private static final String PERMISSION_PREFIX = "admin.supplier-management";

  private final SupplierService service;
  private final PermissionGuard permissionGuard;

  public SupplierController(SupplierService service, PermissionGuard permissionGuard) {
    super(service, permissionGuard, PERMISSION_PREFIX);
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @Override
  @GetMapping
  public ApiResponse<List<Supplier>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(service.listSuppliers());
  }

  @Override
  @PostMapping
  public ApiResponse<Supplier> create(@Valid @RequestBody Supplier supplier) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    return ApiResponse.ok(service.createSupplier(supplier));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<Supplier> update(
      @PathVariable Long id,
      @Valid @RequestBody Supplier supplier) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    return ApiResponse.ok(service.updateSupplier(id, supplier));
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<Supplier> updateStatus(
      @PathVariable Long id,
      @Valid @RequestBody SupplierStatusRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".toggle-status");
    Supplier updated = service.updateStatus(id, request.status());
    if (updated == null) {
      throw new IllegalArgumentException("供应商不存在");
    }
    return ApiResponse.ok(updated);
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    return ApiResponse.ok(service.deleteSupplier(id));
  }
}
