package com.zdm.platform.role;

import com.zdm.platform.common.ApiResponse;
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
@RequestMapping("/api/admin/roles")
public class RoleController {
  private final RoleService roleService;

  public RoleController(RoleService roleService) {
    this.roleService = roleService;
  }

  @GetMapping
  public ApiResponse<List<Role>> list() {
    return ApiResponse.ok(roleService.listForCurrentAdmin());
  }

  @GetMapping("/permission-scope")
  public ApiResponse<RolePermissionScope> permissionScope() {
    return ApiResponse.ok(roleService.permissionScopeForCurrentAdmin());
  }

  @PostMapping
  public ApiResponse<Role> create(@Valid @RequestBody Role role) {
    roleService.createRole(role);
    return ApiResponse.ok(role);
  }

  @PutMapping("/{id}")
  public ApiResponse<Role> update(@PathVariable Long id, @Valid @RequestBody Role role) {
    roleService.updateRole(id, role);
    return ApiResponse.ok(roleService.getById(id));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    return ApiResponse.ok(roleService.deleteRole(id));
  }
}
