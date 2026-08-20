package com.zdm.platform.tenant;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.List;
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
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".unarchived.create");
    tenant.setId(null);
    return ApiResponse.ok(tenantService.createTenant(tenant));
  }

  @PutMapping("/{id}")
  public ApiResponse<Tenant> update(@PathVariable Long id, @Valid @RequestBody Tenant tenant) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".unarchived.edit");
    return ApiResponse.ok(tenantService.updateTenant(id, tenant));
  }

  @PatchMapping("/{id}/businesses")
  public ApiResponse<Tenant> updateBusinesses(
      @PathVariable Long id,
      @RequestBody TenantBusinessUpdateRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".unarchived.open-business");
    return ApiResponse.ok(tenantService.updateBusinesses(id, request.businessTypes()));
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<Tenant> updateStatus(
      @PathVariable Long id,
      @Valid @RequestBody TenantStatusUpdateRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX
        + ("disabled".equals(request.status()) ? ".unarchived.archive" : ".archived.restore"));
    return ApiResponse.ok(tenantService.updateStatus(id, request.status()));
  }

  @GetMapping("/{id}/purge-preview")
  public ApiResponse<TenantPurgePreview> purgePreview(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".archived.delete");
    requirePlatformIdentity();
    return ApiResponse.ok(tenantService.getPurgePreview(id));
  }

  @PostMapping("/{id}/purge")
  public ApiResponse<TenantPurgeResult> purge(
      @PathVariable Long id,
      @Valid @RequestBody TenantPurgeRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".archived.delete");
    requirePlatformIdentity();
    return ApiResponse.ok(tenantService.purgeTenant(id, request.confirmationName()));
  }

  private void requirePlatformIdentity() {
    var identity = permissionGuard.identity();
    if (identity.tenantId() != null || identity.storeId() != null) {
      throw new org.springframework.security.access.AccessDeniedException("仅平台身份可执行当前操作");
    }
  }
}
