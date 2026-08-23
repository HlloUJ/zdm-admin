package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.media.MediaStorageService;
import com.zdm.platform.media.MediaUploadResponse;
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
        PERMISSION_PREFIX + ".warehouse.publish",
        PERMISSION_PREFIX + ".warehouse.edit",
        PERMISSION_PREFIX + ".selling.publish",
        PERMISSION_PREFIX + ".selling.edit",
        PERMISSION_PREFIX + ".offShelf.edit");
    permissionGuard.requireAllData();
    return ApiResponse.ok(mediaAssetService.upload(file, MediaStorageService.defaultImageSizeLimit()));
  }

  @DeleteMapping("/images")
  public ApiResponse<Boolean> deleteUnreferencedImage(@RequestParam Long mediaId) {
    permissionGuard.requireAnyPermission(
        PERMISSION_PREFIX + ".create",
        PERMISSION_PREFIX + ".edit",
        PERMISSION_PREFIX + ".delete",
        PERMISSION_PREFIX + ".warehouse.publish",
        PERMISSION_PREFIX + ".warehouse.edit",
        PERMISSION_PREFIX + ".selling.publish",
        PERMISSION_PREFIX + ".selling.edit",
        PERMISSION_PREFIX + ".offShelf.edit");
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
    String scope = "selling".equals(inventory.getStatus()) ? "selling" : "warehouse";
    permissionGuard.requireAnyPermission(
        PERMISSION_PREFIX + ".create", PERMISSION_PREFIX + "." + scope + ".publish");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.createWithPrices(inventory));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<SlabInventory> update(
      @PathVariable Long id, @Valid @RequestBody SlabInventory inventory) {
    SlabInventory existing = service.getById(id);
    String scope = statusScope(existing == null ? null : existing.getStatus());
    permissionGuard.requireAnyPermission(
        PERMISSION_PREFIX + ".edit",
        PERMISSION_PREFIX + "." + scope + ".edit",
        PERMISSION_PREFIX + "." + scope + ".price");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.updateWithPrices(id, inventory));
  }

  @PutMapping("/batch-status")
  public ApiResponse<Boolean> updateBatchStatus(@Valid @RequestBody SlabInventoryBatchStatusRequest request) {
    requireStatusPermissions(request);
    permissionGuard.requireAllData();
    service.updateStatuses(request.ids(), request.status());
    return ApiResponse.ok(true);
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requireAnyPermission(
        PERMISSION_PREFIX + ".delete",
        PERMISSION_PREFIX + ".recycle.purge",
        PERMISSION_PREFIX + ".recycle.batch-purge",
        PERMISSION_PREFIX + ".recycle.clear-recycle");
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
        PERMISSION_PREFIX + ".warehouse.reject", PERMISSION_PREFIX + ".edit");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.reject(id, request.reason(), request.detail()));
  }

  private void requireStatusPermissions(SlabInventoryBatchStatusRequest request) {
    boolean batch = request.ids().size() > 1;
    for (Long id : request.ids()) {
      SlabInventory inventory = service.getById(id);
      String scope = statusScope(inventory == null ? null : inventory.getStatus());
      String action = statusAction(request.status(), batch);
      permissionGuard.requireAnyPermission(
          PERMISSION_PREFIX + ".edit", PERMISSION_PREFIX + "." + scope + "." + action);
    }
  }

  private String statusScope(String status) {
    return "pendingReview".equals(status) ? "warehouse" : status == null ? "warehouse" : status;
  }

  private String statusAction(String targetStatus, boolean batch) {
    return switch (targetStatus) {
      case "selling" -> batch ? "batch-shelf" : "shelf";
      case "offShelf" -> batch ? "batch-off-shelf" : "off-shelf";
      case "warehouse" -> batch ? "batch-restore" : "restore";
      case "recycle" -> "delete";
      default -> throw new IllegalArgumentException("大板状态不正确");
    };
  }
}
