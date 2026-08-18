package com.zdm.platform.tenant;

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
@RequestMapping("/api/admin/tenants")
public class TenantController {
  private static final String PERMISSION_PREFIX = "admin.tenant.tenant-management";

  private final TenantService tenantService;
  private final PermissionGuard permissionGuard;

  public TenantController(TenantService tenantService, PermissionGuard permissionGuard) {
    this.tenantService = tenantService;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<Tenant>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(tenantService.listTenants());
  }

  @PostMapping
  public ApiResponse<Tenant> create(@Valid @RequestBody Tenant tenant) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    tenant.setId(null);
    return ApiResponse.ok(tenantService.createTenant(tenant));
  }

  @PutMapping("/{id}")
  public ApiResponse<Tenant> update(@PathVariable Long id, @Valid @RequestBody Tenant tenant) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    return ApiResponse.ok(tenantService.updateTenant(id, tenant));
  }

  @PatchMapping("/{id}/businesses")
  public ApiResponse<Tenant> updateBusinesses(
      @PathVariable Long id,
      @RequestBody TenantBusinessUpdateRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".open-business");
    return ApiResponse.ok(tenantService.updateBusinesses(id, request.businessTypes()));
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<Tenant> updateStatus(
      @PathVariable Long id,
      @Valid @RequestBody TenantStatusUpdateRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".toggle-status");
    return ApiResponse.ok(tenantService.updateStatus(id, request.status()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    return ApiResponse.ok(tenantService.deleteTenant(id));
  }
}
