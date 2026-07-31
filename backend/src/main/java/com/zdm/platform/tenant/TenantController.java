package com.zdm.platform.tenant;

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
    permissionGuard.requireAllData();
    return ApiResponse.ok(tenantService.list());
  }

  @PostMapping
  public ApiResponse<Tenant> create(@Valid @RequestBody Tenant tenant) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    permissionGuard.requireAllData();
    tenant.setId(null);
    tenantService.save(tenant);
    return ApiResponse.ok(tenant);
  }

  @PutMapping("/{id}")
  public ApiResponse<Tenant> update(@PathVariable Long id, @Valid @RequestBody Tenant tenant) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    permissionGuard.requireAllData();
    tenant.setId(id);
    tenantService.updateById(tenant);
    return ApiResponse.ok(tenantService.getById(id));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    permissionGuard.requireAllData();
    return ApiResponse.ok(tenantService.removeById(id));
  }
}
