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

  @GetMapping("/{id}")
  public ApiResponse<FinishedProduct> detail(@PathVariable Long id) {
    if (!"admin".equals(permissionGuard.identity().clientCode())) {
      throw new org.springframework.security.access.AccessDeniedException("无权访问当前功能");
    }
    permissionGuard.requireView(PERMISSION_PREFIX);
    permissionGuard.requireAnyPermission(permission("warehouse", "detail"), permission("selling", "detail"),
        permission("off-shelf", "detail"), permission("sold-out", "detail"), permission("recycle", "detail"));
    permissionGuard.requireDataPermission();
    FinishedProduct product = service.visibleDetail(id);
    if (product == null) { throw new IllegalArgumentException("成品现货不存在或不可访问"); }
    String status = scope(product.getStatus());
    permissionGuard.requireAnyPermission(PERMISSION_PREFIX + ".view", permission(status, "view"));
    permissionGuard.requirePermission(permission(status, "detail"));
    return ApiResponse.ok(service.withDetails(product));
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
    permissionGuard.requirePermission(prefix() + ".operation-log.view");
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(operationLogs.listPage(keyword, operationType, operatorName, startDate, endDate, page, pageSize));
  }

  @GetMapping("/operation-logs/{id}")
  public ApiResponse<FinishedOperationLog> operationLogDetail(@PathVariable Long id) {
    permissionGuard.requirePermission(prefix() + ".operation-log.view");
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(operationLogs.detail(id));
  }

  @GetMapping("/attribute-template-options")
  public ApiResponse<List<FinishedProductService.AttributeTemplateOption>> attributeTemplateOptions() {
    permissionGuard.requireView(prefix());
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(service.attributeTemplateOptions());
  }

  @GetMapping("/price-level-options")
  public ApiResponse<List<StoreLevelPricingDirectory.Level>> priceLevelOptions() {
    permissionGuard.requireView(prefix());
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(storeLevelDirectory.listEnabledLevels());
  }

  @PostMapping("/media")
  public ApiResponse<MediaUploadResponse> uploadMedia(@RequestParam("file") MultipartFile file) {
    requireProductFormPermission();
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(mediaAssetService.upload(file, MediaStorageService.defaultImageSizeLimit()));
  }

  @DeleteMapping("/media")
  public ApiResponse<Boolean> deleteTemporaryMedia(@RequestParam Long mediaId) {
    requireProductFormPermission();
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(service.cleanupTemporaryMedia(mediaId));
  }

  @Override
  @GetMapping
  public ApiResponse<List<FinishedProduct>> list() {
    permissionGuard.requireView(prefix());
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(permissionGuard.filterData(service.listWithDetails()).stream()
        .filter(product -> permissionGuard.hasPermission(prefix() + ".view")
            || permissionGuard.hasPermission(permission(scope(isSupplyChain() ? product.getSourceStatus() : product.getStatus()), "view")))
        .toList());
  }

  @Override
  @PostMapping
  public ApiResponse<FinishedProduct> create(@Valid @RequestBody FinishedProduct product) {
    permissionGuard.requireAnyPermission(permission("warehouse","publish"),permission("selling","publish"));
    permissionGuard.requireDataPermission();
    if(isSupplyChain() && "selling".equals(product.getStatus()) && !"接口获取".equals(product.getPublisherType())) { permissionGuard.requireAnyPermission(permission("warehouse","shelf"),permission("selling","publish")); }
    return ApiResponse.ok(service.createWithDetails(product));
  }

  @PostMapping("/{id}/shelf-check")
  public ApiResponse<Boolean> checkShelf(@PathVariable Long id) {
    if (!"admin".equals(permissionGuard.identity().clientCode())) { throw new org.springframework.security.access.AccessDeniedException("此操作属于运营管理平台"); }
    permissionGuard.requireDataPermission();
    FinishedProduct product = service.getById(id);
    if (product == null) { throw new IllegalArgumentException("成品现货不存在或已被删除"); }
    permissionGuard.requireData(product);
    permissionGuard.requireAnyPermission(permission(scope(product.getStatus()), "shelf"),
        permission(scope(product.getStatus()), "batch-shelf"));
    service.checkOperationsShelf(id);
    return ApiResponse.ok(true);
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<FinishedProduct> update(
      @PathVariable Long id, @Valid @RequestBody FinishedProduct product) {
    permissionGuard.requireDataPermission();
    FinishedProduct existing = service.getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("成品现货不存在或已被删除");
    }
    permissionGuard.requireData(existing);
    if (isSupplyChain()) {
      if (!java.util.Objects.equals(existing.getSourceStatus(),product.getStatus())) {
        String action = transitionAction(existing.getSourceStatus(),product.getStatus());
        permissionGuard.requireAnyPermission(permission(scope(existing.getSourceStatus()),action),permission(scope(existing.getSourceStatus()),"batch-"+action));
        if("selling".equals(product.getStatus()) && permissionGuard.hasPermission(permission(scope(existing.getSourceStatus()),"edit"))) { return ApiResponse.ok(service.updateWithDetails(id,product)); }
        return ApiResponse.ok(service.sourceTransition(id,product.getStatus(),product.getOffShelfReason(),product.getOffShelfDetail()));
      }
      permissionGuard.requirePermission(permission(scope(existing.getSourceStatus()),"edit"));
      return ApiResponse.ok(service.updateWithDetails(id,product));
    }
    if (existing.isSourceUnavailable() || Boolean.TRUE.equals(existing.getOperationsDeleted())) {
      throw new IllegalArgumentException("该商品已被供应链删除或运营已彻底删除，不能执行此操作");
    }
    String source = scope(existing.getStatus());
    if (permissionGuard.hasPermission(prefix() + ".edit")) {
      return ApiResponse.ok(service.updateWithDetails(id, product));
    }
    if (!java.util.Objects.equals(existing.getStatus(), product.getStatus())) {
      String action = transitionAction(existing.getStatus(), product.getStatus());
      permissionGuard.requireAnyPermission(permission(source, action), permission(source, "batch-" + action));
      if (("warehouse".equals(source) || "selling".equals(source))
          && permissionGuard.hasPermission(permission(source, "edit"))) {
        return ApiResponse.ok(service.updateWithDetails(id, product));
      }
      return ApiResponse.ok(service.updateOperationWithDetails(id, product, false));
    }
    if (("warehouse".equals(source) || "selling".equals(source))
        && permissionGuard.hasPermission(permission(source, "edit"))) {
      return ApiResponse.ok(service.updateWithDetails(id, product));
    }
    if (!"warehouse".equals(source) && !"selling".equals(source)) {
      throw new org.springframework.security.access.AccessDeniedException("当前状态不允许编辑价格");
    }
    permissionGuard.requirePermission(permission(source, "price"));
    return ApiResponse.ok(service.updateOperationWithDetails(id, product, true));
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requireAnyPermission(prefix() + ".delete",
        permission("recycle", "purge"), permission("recycle", "batch-purge"), permission("recycle", "clear"));
    permissionGuard.requireDataPermission();
    FinishedProduct product = service.getById(id);
    if (product == null || (isSupplyChain() ? !"recycle".equals(product.getSourceStatus()) : (Boolean.TRUE.equals(product.getOperationsDeleted()) || (!"recycle".equals(product.getStatus()) && !product.isSourceUnavailable())))) {
      throw new IllegalArgumentException("只有回收站中的成品现货可以彻底删除");
    }
    permissionGuard.requireData(product);
    return ApiResponse.ok(service.removeById(id));
  }
  private boolean isSupplyChain() { return "supply-chain".equals(permissionGuard.identity().clientCode()); }
  private String prefix() { return (isSupplyChain()?"supply-chain.":"admin.")+"finished-stock-management"; }
  private String permission(String scope, String action) {
    return prefix() + "." + scope + "." + action;
  }

  private static String scope(String status) {
    if (status == null) {
      return "warehouse";
    }
    return switch (status) {
      case "offShelf" -> "off-shelf";
      case "soldOut" -> "sold-out";
      default -> status;
    };
  }

  private void requireProductFormPermission() {
    permissionGuard.requireAnyPermission(prefix() + ".create", prefix() + ".edit",
        permission("warehouse", "publish"), permission("selling", "publish"),
        permission("warehouse", "edit"), permission("selling", "edit"));
  }

  private static String transitionAction(String source, String target) {
    if ("warehouse".equals(source) && "selling".equals(target)) {
      return "shelf";
    }
    if ("selling".equals(source) && "offShelf".equals(target)) {
      return "off-shelf";
    }
    if (("offShelf".equals(source) || "recycle".equals(source)) && "warehouse".equals(target)) {
      return "restore";
    }
    if (("warehouse".equals(source) || "offShelf".equals(source)) && "recycle".equals(target)) {
      return "delete";
    }
    throw new org.springframework.security.access.AccessDeniedException("无权执行当前状态操作");
  }

}
