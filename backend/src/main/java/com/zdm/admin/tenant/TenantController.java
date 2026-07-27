package com.zdm.admin.tenant;

import com.zdm.admin.common.ApiResponse;
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
@RequestMapping("/api/tenants")
public class TenantController {
  private final TenantService tenantService;

  public TenantController(TenantService tenantService) {
    this.tenantService = tenantService;
  }

  @GetMapping
  public ApiResponse<List<Tenant>> list() {
    return ApiResponse.ok(tenantService.list());
  }

  @PostMapping
  public ApiResponse<Tenant> create(@Valid @RequestBody Tenant tenant) {
    tenant.setId(null);
    tenantService.save(tenant);
    return ApiResponse.ok(tenant);
  }

  @PutMapping("/{id}")
  public ApiResponse<Tenant> update(@PathVariable Long id, @Valid @RequestBody Tenant tenant) {
    tenant.setId(id);
    tenantService.updateById(tenant);
    return ApiResponse.ok(tenantService.getById(id));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    return ApiResponse.ok(tenantService.removeById(id));
  }
}
