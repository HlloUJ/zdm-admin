package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/admin/slabs")
public class SlabInventoryController extends AdminCrudController<SlabInventory> {
  private static final String PERMISSION_PREFIX = "admin.slab-management";
  private final SlabInventoryService service;
  private final PermissionGuard permissionGuard;
  private final SlabImageStorageService imageStorageService;

  public SlabInventoryController(
      SlabInventoryService service,
      PermissionGuard permissionGuard,
      SlabImageStorageService imageStorageService) {
    super(service, permissionGuard, PERMISSION_PREFIX);
    this.service = service;
    this.permissionGuard = permissionGuard;
    this.imageStorageService = imageStorageService;
  }

  @PostMapping("/images")
  public ApiResponse<SlabImageUploadResponse> uploadImage(@RequestParam("file") MultipartFile file) {
    permissionGuard.requireAnyPermission(PERMISSION_PREFIX + ".create", PERMISSION_PREFIX + ".edit");
    permissionGuard.requireAllData();
    return ApiResponse.ok(new SlabImageUploadResponse(imageStorageService.store(file)));
  }

  @DeleteMapping("/images")
  public ApiResponse<Boolean> deleteUnreferencedImage(@RequestParam String url) {
    permissionGuard.requireAnyPermission(
        PERMISSION_PREFIX + ".create", PERMISSION_PREFIX + ".edit", PERMISSION_PREFIX + ".delete");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.cleanupTemporaryMedia(url));
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
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.createWithPrices(inventory));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<SlabInventory> update(
      @PathVariable Long id, @Valid @RequestBody SlabInventory inventory) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.updateWithPrices(id, inventory));
  }

  @PutMapping("/batch-status")
  public ApiResponse<Boolean> updateBatchStatus(@Valid @RequestBody SlabInventoryBatchStatusRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    permissionGuard.requireAllData();
    service.updateStatuses(request.ids(), request.status());
    return ApiResponse.ok(true);
  }
}
