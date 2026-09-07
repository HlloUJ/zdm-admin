package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.common.StoreLevelPricingDirectory;
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
@RequestMapping("/api/admin/finished-products")
public class FinishedProductController extends AdminCrudController<FinishedProduct> {
  private static final String PERMISSION_PREFIX = "admin.finished-stock-management";
  private final FinishedProductService service;
  private final PermissionGuard permissionGuard;
  private final MediaAssetService mediaAssetService;
  private final StoreLevelPricingDirectory storeLevelDirectory;

  public FinishedProductController(
      FinishedProductService service,
      PermissionGuard permissionGuard,
      MediaAssetService mediaAssetService,
      StoreLevelPricingDirectory storeLevelDirectory) {
    super(service, permissionGuard, PERMISSION_PREFIX);
    this.service = service;
    this.permissionGuard = permissionGuard;
    this.mediaAssetService = mediaAssetService;
    this.storeLevelDirectory = storeLevelDirectory;
  }

  @GetMapping("/price-level-options")
  public ApiResponse<List<StoreLevelPricingDirectory.Level>> priceLevelOptions() {
    permissionGuard.requireAnyPermission(PERMISSION_PREFIX + ".create", PERMISSION_PREFIX + ".edit");
    permissionGuard.requireAllData();
    return ApiResponse.ok(storeLevelDirectory.listEnabledLevels());
  }

  @PostMapping("/media")
  public ApiResponse<MediaUploadResponse> uploadMedia(@RequestParam("file") MultipartFile file) {
    permissionGuard.requireAnyPermission(PERMISSION_PREFIX + ".create", PERMISSION_PREFIX + ".edit");
    permissionGuard.requireAllData();
    return ApiResponse.ok(mediaAssetService.upload(file, MediaStorageService.defaultImageSizeLimit()));
  }

  @DeleteMapping("/media")
  public ApiResponse<Boolean> deleteTemporaryMedia(@RequestParam Long mediaId) {
    permissionGuard.requireAnyPermission(PERMISSION_PREFIX + ".create", PERMISSION_PREFIX + ".edit");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.cleanupTemporaryMedia(mediaId));
  }

  @Override
  @GetMapping
  public ApiResponse<List<FinishedProduct>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.listWithDetails());
  }

  @Override
  @PostMapping
  public ApiResponse<FinishedProduct> create(@Valid @RequestBody FinishedProduct product) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.createWithDetails(product));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<FinishedProduct> update(
      @PathVariable Long id, @Valid @RequestBody FinishedProduct product) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    permissionGuard.requireAllData();
    return ApiResponse.ok(service.updateWithDetails(id, product));
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    permissionGuard.requireAllData();
    FinishedProduct product = service.getById(id);
    if (product == null || !"recycle".equals(product.getStatus())) {
      throw new IllegalArgumentException("只有回收站中的成品现货可以彻底删除");
    }
    return ApiResponse.ok(service.removeById(id));
  }
}
