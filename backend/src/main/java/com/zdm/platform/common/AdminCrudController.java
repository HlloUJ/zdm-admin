package com.zdm.platform.common;

import com.baomidou.mybatisplus.extension.service.IService;
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

  protected AdminCrudController(IService<T> service) {
    this.service = service;
  }

  @GetMapping
  public ApiResponse<List<T>> list() {
    return ApiResponse.ok(service.list());
  }

  @PostMapping
  public ApiResponse<T> create(@Valid @RequestBody T entity) {
    entity.setId(null);
    service.save(entity);
    return ApiResponse.ok(entity);
  }

  @PutMapping("/{id}")
  public ApiResponse<T> update(@PathVariable Long id, @Valid @RequestBody T entity) {
    entity.setId(id);
    service.updateById(entity);
    return ApiResponse.ok(service.getById(id));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    return ApiResponse.ok(service.removeById(id));
  }
}
