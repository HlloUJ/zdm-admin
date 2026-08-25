package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
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
@RequestMapping("/api/admin/slab-grades")
public class SlabGradeController extends AdminCrudController<SlabGrade> {
  private static final String PERMISSION_PREFIX = "admin.product-data-center.slab-grade";

  private final SlabGradeService service;
  private final PermissionGuard permissionGuard;

  public SlabGradeController(SlabGradeService service, PermissionGuard permissionGuard) {
    super(service, permissionGuard, PERMISSION_PREFIX);
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @Override
  @GetMapping
  public ApiResponse<List<SlabGrade>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(service.listGrades());
  }

  @Override
  @PostMapping
  public ApiResponse<SlabGrade> create(@Valid @RequestBody SlabGrade grade) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    return ApiResponse.ok(service.createGrade(grade));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<SlabGrade> update(@PathVariable Long id, @Valid @RequestBody SlabGrade payload) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    SlabGrade updated = service.updateGrade(id, payload);
    if (updated == null) {
      throw new IllegalArgumentException("等级不存在");
    }
    return ApiResponse.ok(updated);
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<SlabGrade> updateStatus(
      @PathVariable Long id, @Valid @RequestBody SlabGradeStatusRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".toggle-status");
    SlabGrade updated = service.updateStatus(id, request.status());
    if (updated == null) {
      throw new IllegalArgumentException("等级不存在");
    }
    return ApiResponse.ok(updated);
  }

  @PatchMapping("/reorder")
  public ApiResponse<List<SlabGrade>> reorder(
      @Valid @RequestBody SlabGradeReorderRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".sort");
    return ApiResponse.ok(service.reorderGrades(request.orderedIds()));
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    return ApiResponse.ok(service.deleteGrade(id));
  }
}
