package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.media.MediaStorageService;
import com.zdm.platform.media.MediaUploadResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Objects;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/admin/slabs")
public class SlabInventoryController extends AdminCrudController<SlabInventory> {
  private static final String PERMISSION_PREFIX = "admin.slab-management";
  private final SlabInventoryService service;
  private final PermissionGuard permissionGuard;
  private final MediaAssetService mediaAssetService;

  public SlabInventoryController(
      SlabInventoryService service,
      PermissionGuard permissionGuard,
      MediaAssetService mediaAssetService) {
    super(service, permissionGuard, PERMISSION_PREFIX);
    this.service = service;
    this.permissionGuard = permissionGuard;
    this.mediaAssetService = mediaAssetService;
  }

  @PostMapping("/images")
  public ApiResponse<MediaUploadResponse> uploadImage(@RequestParam("file") MultipartFile file) {
    permissionGuard.requireAnyPermission(
        PERMISSION_PREFIX + ".create",
        PERMISSION_PREFIX + ".edit",
        permission("warehouse", "publish"),
        permission("selling", "publish"),
        permission("warehouse", "edit"),
        permission("selling", "edit"),
        permission("off-shelf", "edit"));
    permissionGuard.requireAllData();
    return ApiResponse.ok(mediaAssetService.upload(file, MediaStorageService.defaultImageSizeLimit()));
  }

  @DeleteMapping("/images")
  public ApiResponse<Boolean> deleteUnreferencedImage(@RequestParam Long mediaId) {
    permissionGuard.requireAnyPermission(
        PERMISSION_PREFIX + ".create",
        PERMISSION_PREFIX + ".edit",
        PERMISSION_PREFIX + ".delete",
        permission("warehouse", "publish"),
        permission("selling", "publish"),
        permission("warehouse", "edit"),
        permission("selling", "edit"),
        permission("off-shelf", "edit"));
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.cleanupTemporaryMedia(mediaId));
  }

  @GetMapping("/publish-options")
  public ApiResponse<SlabPublishOptions> publishOptions() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(service.listPublishOptions());
  }

  @Override
  @GetMapping
  public ApiResponse<List<SlabInventory>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.listWithPrices());
  }

  @Override
  @PostMapping
  public ApiResponse<SlabInventory> create(@Valid @RequestBody SlabInventory inventory) {
    String targetStatus = inventory.getStatus();
    if (targetStatus == null || "warehouse".equals(targetStatus)) {
      permissionGuard.requireAnyPermission(PERMISSION_PREFIX + ".create", permission("warehouse", "publish"));
    } else if ("selling".equals(targetStatus)) {
      permissionGuard.requireAnyPermission(PERMISSION_PREFIX + ".create", permission("selling", "publish"));
    } else {
      permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    }
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.createWithPrices(inventory));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<SlabInventory> update(
      @PathVariable Long id, @Valid @RequestBody SlabInventory inventory) {
    SlabInventory existing = service.getById(id);
    String scope = statusScope(existing == null ? null : existing.getStatus());
    if (scope == null || (!"warehouse".equals(scope) && !"selling".equals(scope))) {
      permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    } else {
      permissionGuard.requireAnyPermission(
          PERMISSION_PREFIX + ".edit",
          permission(scope, "edit"),
          permission(scope, "price"));
    }
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.updateWithPrices(id, inventory));
  }

  @PutMapping("/batch-status")
  public ApiResponse<Boolean> updateBatchStatus(@Valid @RequestBody SlabInventoryBatchStatusRequest request) {
    service.listByIds(request.ids()).stream()
        .map(SlabInventory::getStatus)
        .filter(Objects::nonNull)
        .distinct()
        .forEach(status -> requireStatusTransition(status, request.status()));
    permissionGuard.requireAllData();
    service.updateStatuses(request.ids(), request.status(), request.reason(), request.detail());
    return ApiResponse.ok(true);
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requireAnyPermission(
        PERMISSION_PREFIX + ".delete",
        permission("recycle", "purge"),
        permission("recycle", "batch-purge"),
        permission("recycle", "clear"));
    permissionGuard.requireAllData();
    SlabInventory inventory = service.getById(id);
    if (inventory == null || !"recycle".equals(inventory.getStatus())) {
      throw new IllegalArgumentException("只有回收站中的大板可以彻底删除");
    }
    return ApiResponse.ok(service.removeById(id));
  }

  @PutMapping("/{id}/reject")
  public ApiResponse<SlabInventory> reject(
      @PathVariable Long id, @Valid @RequestBody SlabRejectionRequest request) {
    permissionGuard.requireAnyPermission(
        permission("warehouse", "reject"), PERMISSION_PREFIX + ".edit");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.reject(id, request.reason(), request.detail()));
  }

  private void requireStatusTransition(String sourceStatus, String targetStatus) {
    if (("warehouse".equals(sourceStatus) || "pendingReview".equals(sourceStatus))
        && "selling".equals(targetStatus)) {
      requireEditOr(permission("warehouse", "shelf"), permission("warehouse", "batch-shelf"));
      return;
    }
    if ("selling".equals(sourceStatus) && "offShelf".equals(targetStatus)) {
      requireEditOr(permission("selling", "off-shelf"), permission("selling", "batch-off-shelf"));
      return;
    }
    if ("warehouse".equals(targetStatus) && "offShelf".equals(sourceStatus)) {
      requireEditOr(permission("off-shelf", "restore"), permission("off-shelf", "batch-restore"));
      return;
    }
    if ("warehouse".equals(targetStatus) && "recycle".equals(sourceStatus)) {
      requireEditOr(permission("recycle", "restore"), permission("recycle", "batch-restore"));
      return;
    }
    if ("recycle".equals(targetStatus)) {
      if ("warehouse".equals(sourceStatus)) {
        requireEditOr(permission("warehouse", "delete"), permission("warehouse", "reject"));
        return;
      }
      if ("selling".equals(sourceStatus)) {
        requireEditOr(permission("selling", "delete"), permission("selling", "reject"));
        return;
      }
      if ("offShelf".equals(sourceStatus)) {
        requireEditOr(permission("off-shelf", "delete"));
        return;
      }
    }
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
  }

  private void requireEditOr(String... permissions) {
    String[] candidates = new String[permissions.length + 1];
    candidates[0] = PERMISSION_PREFIX + ".edit";
    System.arraycopy(permissions, 0, candidates, 1, permissions.length);
    permissionGuard.requireAnyPermission(candidates);
  }

  private String statusScope(String status) {
    return switch (status == null ? "" : status) {
      case "warehouse", "selling", "recycle" -> status;
      case "pendingReview" -> "warehouse";
      case "offShelf" -> "off-shelf";
      case "soldOut" -> "sold-out";
      default -> null;
    };
  }

  private String permission(String scope, String action) {
    return PERMISSION_PREFIX + "." + scope + "." + action;
  }
}
