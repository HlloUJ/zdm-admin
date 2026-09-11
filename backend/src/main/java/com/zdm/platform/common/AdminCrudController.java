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

public abstract class AdminCrudController<T extends Identifiable & com.zdm.platform.security.CreatorOwned> {
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
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(permissionGuard.filterData(service.list()));
  }

  @PostMapping
  public ApiResponse<T> create(@Valid @RequestBody T entity) {
    permissionGuard.requirePermission(permissionPrefix + ".create");
    permissionGuard.requireDataPermission();
    entity.setId(null);
    entity.setCreatedByAccountId(permissionGuard.identity().accountId());
    service.save(entity);
    return ApiResponse.ok(entity);
  }

  @PutMapping("/{id}")
  public ApiResponse<T> update(@PathVariable Long id, @Valid @RequestBody T entity) {
    permissionGuard.requirePermission(permissionPrefix + ".edit");
    permissionGuard.requireDataPermission();
    T existing = service.getById(id);
    if (existing == null) { throw new IllegalArgumentException("数据不存在"); }
    permissionGuard.requireData(existing);
    entity.setCreatedByAccountId(existing.getCreatedByAccountId());
    entity.setId(id);
    service.updateById(entity);
    return ApiResponse.ok(service.getById(id));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(permissionPrefix + ".delete");
    permissionGuard.requireDataPermission();
    permissionGuard.requireData(service.getById(id));
    return ApiResponse.ok(service.removeById(id));
  }
}
