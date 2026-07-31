package com.zdm.platform.common;

import com.baomidou.mybatisplus.extension.service.IService;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;

public abstract class AdminCrudController<T extends Identifiable> {
  private final IService<T> service;
  private final PermissionGuard permissionGuard;
  private final String permissionPrefix;

  protected AdminCrudController(IService<T> service, PermissionGuard permissionGuard, String permissionPrefix) {
    this.service = service;
    this.permissionGuard = permissionGuard;
    this.permissionPrefix = permissionPrefix;
  }

  @GetMapping
  public ApiResponse<List<T>> list() {
    permissionGuard.requireView(permissionPrefix);
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.list());
  }

  @PostMapping
  public ApiResponse<T> create(@Valid @RequestBody T entity) {
    permissionGuard.requirePermission(permissionPrefix + ".create");
    permissionGuard.requireAllData();
    entity.setId(null);
    service.save(entity);
    return ApiResponse.ok(entity);
  }

  @PutMapping("/{id}")
  public ApiResponse<T> update(@PathVariable Long id, @Valid @RequestBody T entity) {
    permissionGuard.requirePermission(permissionPrefix + ".edit");
    permissionGuard.requireAllData();
    entity.setId(id);
    service.updateById(entity);
    return ApiResponse.ok(service.getById(id));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(permissionPrefix + ".delete");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.removeById(id));
  }
}
