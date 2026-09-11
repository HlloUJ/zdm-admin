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
  private final FinishedOperationLogService operationLogs;
  private final PermissionGuard permissionGuard;
  private final MediaAssetService mediaAssetService;
  private final StoreLevelPricingDirectory storeLevelDirectory;

  public FinishedProductController(
      FinishedProductService service,
      FinishedOperationLogService operationLogs,
      PermissionGuard permissionGuard,
      MediaAssetService mediaAssetService,
      StoreLevelPricingDirectory storeLevelDirectory) {
    super(service, permissionGuard, PERMISSION_PREFIX);
    this.service = service;
    this.operationLogs = operationLogs;
    this.permissionGuard = permissionGuard;
    this.mediaAssetService = mediaAssetService;
    this.storeLevelDirectory = storeLevelDirectory;
  }

  @GetMapping("/operation-logs")
  public ApiResponse<FinishedOperationLogPage> operationLogs(
      @RequestParam(required = false) String keyword,
      @RequestParam(required = false) String operationType,
      @RequestParam(required = false) String operatorName,
      @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) java.time.LocalDate startDate,
      @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) java.time.LocalDate endDate,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int pageSize) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".operation-log.view");
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(operationLogs.listPage(keyword, operationType, operatorName, startDate, endDate, page, pageSize));
  }

  @GetMapping("/operation-logs/{id}")
  public ApiResponse<FinishedOperationLog> operationLogDetail(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".operation-log.view");
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(operationLogs.detail(id));
  }

  @GetMapping("/attribute-template-options")
  public ApiResponse<List<FinishedProductService.AttributeTemplateOption>> attributeTemplateOptions() {
    permissionGuard.requireAnyPermission(PERMISSION_PREFIX + ".view", PERMISSION_PREFIX + ".create",
        PERMISSION_PREFIX + ".edit");
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(service.attributeTemplateOptions());
  }

  @GetMapping("/price-level-options")
  public ApiResponse<List<StoreLevelPricingDirectory.Level>> priceLevelOptions() {
    permissionGuard.requireAnyPermission(PERMISSION_PREFIX + ".create", PERMISSION_PREFIX + ".edit");
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(storeLevelDirectory.listEnabledLevels());
  }

  @PostMapping("/media")
  public ApiResponse<MediaUploadResponse> uploadMedia(@RequestParam("file") MultipartFile file) {
    permissionGuard.requireAnyPermission(PERMISSION_PREFIX + ".create", PERMISSION_PREFIX + ".edit");
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(mediaAssetService.upload(file, MediaStorageService.defaultImageSizeLimit()));
  }

  @DeleteMapping("/media")
  public ApiResponse<Boolean> deleteTemporaryMedia(@RequestParam Long mediaId) {
    permissionGuard.requireAnyPermission(PERMISSION_PREFIX + ".create", PERMISSION_PREFIX + ".edit");
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(service.cleanupTemporaryMedia(mediaId));
  }

  @Override
  @GetMapping
  public ApiResponse<List<FinishedProduct>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(permissionGuard.filterData(service.listWithDetails()));
  }

  @Override
  @PostMapping
  public ApiResponse<FinishedProduct> create(@Valid @RequestBody FinishedProduct product) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(service.createWithDetails(product));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<FinishedProduct> update(
      @PathVariable Long id, @Valid @RequestBody FinishedProduct product) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(service.updateWithDetails(id, product));
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    permissionGuard.requireDataPermission();
    FinishedProduct product = service.getById(id);
    if (product == null || !"recycle".equals(product.getStatus())) {
      throw new IllegalArgumentException("只有回收站中的成品现货可以彻底删除");
    }
    return ApiResponse.ok(service.removeById(id));
  }
}
