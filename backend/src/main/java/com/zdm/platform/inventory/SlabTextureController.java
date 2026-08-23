package com.zdm.platform.inventory;

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
@RequestMapping("/api/admin/slab-textures")
public class SlabTextureController {
  private static final String PREFIX = "admin.product-data-center.slab-texture";
  private final SlabTextureService service;
  private final PermissionGuard permissionGuard;

  public SlabTextureController(SlabTextureService service, PermissionGuard permissionGuard) {
    this.service = service;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<SlabTexture>> list() {
    permissionGuard.requireView(PREFIX);
    return ApiResponse.ok(service.list());
  }

  @PostMapping
  public ApiResponse<SlabTexture> create(@Valid @RequestBody SlabTexture texture) {
    permissionGuard.requirePermission(PREFIX + ".create");
    return ApiResponse.ok(service.createTexture(texture));
  }

  @PutMapping("/{id}")
  public ApiResponse<SlabTexture> update(@PathVariable Long id, @Valid @RequestBody SlabTexture texture) {
    permissionGuard.requirePermission(PREFIX + ".edit");
    return ApiResponse.ok(service.updateTexture(id, texture));
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<SlabTexture> updateStatus(
      @PathVariable Long id, @Valid @RequestBody SlabTextureStatusRequest request) {
    permissionGuard.requirePermission(PREFIX + ".toggle-status");
    return ApiResponse.ok(service.updateStatus(id, request.status()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PREFIX + ".delete");
    return ApiResponse.ok(service.deleteTexture(id));
  }

  @GetMapping("/{id}/aliases")
  public ApiResponse<List<SlabTextureAlias>> aliases(@PathVariable Long id) {
    permissionGuard.requireView(PREFIX);
    return ApiResponse.ok(service.listAliases(id));
  }

  @PostMapping("/{id}/aliases")
  public ApiResponse<SlabTextureAlias> createAlias(
      @PathVariable Long id, @Valid @RequestBody SlabTextureAlias alias) {
    permissionGuard.requirePermission(PREFIX + ".manage-aliases");
    return ApiResponse.ok(service.createAlias(id, alias));
  }

  @PutMapping("/{id}/aliases/{aliasId}")
  public ApiResponse<SlabTextureAlias> updateAlias(
      @PathVariable Long id, @PathVariable Long aliasId, @Valid @RequestBody SlabTextureAlias alias) {
    permissionGuard.requirePermission(PREFIX + ".manage-aliases");
    return ApiResponse.ok(service.updateAlias(id, aliasId, alias));
  }

  @DeleteMapping("/{id}/aliases/{aliasId}")
  public ApiResponse<Boolean> deleteAlias(@PathVariable Long id, @PathVariable Long aliasId) {
    permissionGuard.requirePermission(PREFIX + ".manage-aliases");
    return ApiResponse.ok(service.deleteAlias(id, aliasId));
  }
}
