package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.common.StoreLevelPricingDirectory;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.media.MediaStorageService;
import com.zdm.platform.media.MediaUploadResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
@RequestMapping("/api/admin/accessory-products")
public class AccessoryProductController extends AdminCrudController<AccessoryProduct> {
  private static final String PERMISSION_PREFIX = "admin.accessory-management";
  private final AccessoryProductService service;
  private final AccessoryOperationLogService operationLogs;
  private final PermissionGuard permissionGuard;
  private final MediaAssetService mediaAssetService;
  private final StoreLevelPricingDirectory storeLevelDirectory;

  public AccessoryProductController(
      AccessoryProductService service,
      AccessoryOperationLogService operationLogs,
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
  public ApiResponse<AccessoryProduct> detail(@PathVariable Long id) {
    if (!"admin".equals(permissionGuard.identity().clientCode())) {
      throw new org.springframework.security.access.AccessDeniedException("无权访问当前功能");
    }
    permissionGuard.requireView(PERMISSION_PREFIX);
    permissionGuard.requireAnyPermission(permission("warehouse", "edit"), permission("selling", "edit"),
        permission("sold-out", "detail"), permission("recycle", "detail"));
    permissionGuard.requireDataPermission();
    AccessoryProduct product = service.visibleDetail(id);
    if (product == null) { throw new IllegalArgumentException("配件不存在或不可访问"); }
    String status = scope(product.getStatus());
    permissionGuard.requireAnyPermission(PERMISSION_PREFIX + ".view", permission(status, "view"));
    permissionGuard.requirePermission(permission(status, List.of("warehouse", "selling").contains(status) ? "edit" : "detail"));
    return ApiResponse.ok(service.withDetails(product));
  }

  @GetMapping("/operation-logs")
  public ApiResponse<AccessoryOperationLogPage> operationLogs(
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
  public ApiResponse<AccessoryOperationLog> operationLogDetail(@PathVariable Long id) {
    permissionGuard.requirePermission(prefix() + ".operation-log.view");
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(operationLogs.detail(id));
  }

  @GetMapping("/attribute-template-options")
  public ApiResponse<List<AccessoryProductService.AttributeTemplateOption>> attributeTemplateOptions() {
    permissionGuard.requireView(prefix());
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(service.attributeTemplateOptions());
  }

  @GetMapping("/price-level-options")
  public ApiResponse<List<StoreLevelPricingDirectory.Level>> priceLevelOptions() {
    permissionGuard.requireView(prefix());
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(storeLevelDirectory.listOperationalPricingLevels());
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
  public ApiResponse<List<AccessoryProduct>> list() {
    permissionGuard.requireView(prefix());
    permissionGuard.requireDataPermission();
    return ApiResponse.ok(permissionGuard.filterData(service.listWithDetails()).stream()
        .filter(product -> permissionGuard.hasPermission(prefix() + ".view")
            || permissionGuard.hasPermission(permission(scope(isSupplyChain() ? product.getSourceStatus() : product.getStatus()), "view")))
        .map(this::visiblePrices)
        .toList());
  }

  @Override
  @PostMapping
  public ApiResponse<AccessoryProduct> create(@Valid @RequestBody AccessoryProduct product) {
    if (!isSupplyChain()) { throw new org.springframework.security.access.AccessDeniedException("此操作属于供应链协同系统"); }
    permissionGuard.requirePermission(prefix() + ".publish");
    permissionGuard.requireDataPermission();
    if (isSupplyChain() && "selling".equals(product.getStatus())) { permissionGuard.requirePermission(permission("warehouse", "shelf")); }
    return ApiResponse.ok(visiblePrices(service.createWithDetails(product)));
  }

  @PostMapping("/{id}/shelf-check")
  public ApiResponse<Boolean> checkShelf(@PathVariable Long id) {
    if (!"admin".equals(permissionGuard.identity().clientCode())) { throw new org.springframework.security.access.AccessDeniedException("此操作属于运营管理平台"); }
    permissionGuard.requireDataPermission();
    AccessoryProduct product = service.getById(id);
    if (product == null) { throw new IllegalArgumentException("配件不存在或已被删除"); }
    permissionGuard.requireData(product);
    permissionGuard.requireAnyPermission(permission(scope(product.getStatus()), "shelf"),
        permission(scope(product.getStatus()), "batch-shelf"));
    service.checkOperationsShelf(id);
    return ApiResponse.ok(true);
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<AccessoryProduct> update(
      @PathVariable Long id, @Valid @RequestBody AccessoryProduct product) {
    return updateProduct(id, product, false);
  }

  @PutMapping("/{id}/edit")
  public ApiResponse<AccessoryProduct> edit(
      @PathVariable Long id, @Valid @RequestBody AccessoryProduct product) {
    if (!isSupplyChain()) {
      throw new org.springframework.security.access.AccessDeniedException("此操作属于供应链协同系统");
    }
    return updateProduct(id, product, true);
  }

  private ApiResponse<AccessoryProduct> updateProduct(Long id, AccessoryProduct product, boolean editForm) {
    if ("offShelf".equals(product.getStatus())) { throw new IllegalArgumentException("已下架状态已取消"); }
    if (product.getOperation() != null && (!"offShelf".equals(product.getOperation()) || !"warehouse".equals(product.getStatus()))) {
      throw new IllegalArgumentException("商品操作不正确");
    }
    permissionGuard.requireDataPermission();
    AccessoryProduct existing = service.getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("配件不存在或已被删除");
    }
    permissionGuard.requireData(existing);
    if ("offShelf".equals(product.getOperation()) && !"selling".equals(isSupplyChain() ? existing.getSourceStatus() : existing.getStatus())) {
      throw new IllegalArgumentException("只有已上架商品可以下架");
    }
    if ("selling".equals(isSupplyChain() ? existing.getSourceStatus() : existing.getStatus())
        && "warehouse".equals(product.getStatus()) && !editForm && !"offShelf".equals(product.getOperation())) {
      throw new org.springframework.security.access.AccessDeniedException("下架必须使用下架操作");
    }
    if (isSupplyChain()) {
      if (editForm) {
        permissionGuard.requirePermission(permission(scope(existing.getSourceStatus()), "edit"));
      }
      if (!java.util.Objects.equals(existing.getSourceStatus(),product.getStatus())) {
        boolean editToWarehouse = editForm && "selling".equals(existing.getSourceStatus()) && "warehouse".equals(product.getStatus());
        String action = editToWarehouse ? "off-shelf" : transitionAction(existing.getSourceStatus(),product.getStatus());
        permissionGuard.requireAnyPermission(permission(scope(existing.getSourceStatus()),action),permission(scope(existing.getSourceStatus()),"batch-"+action));
        if (editToWarehouse || (editForm && "warehouse".equals(existing.getSourceStatus()) && "selling".equals(product.getStatus()))) {
          return ApiResponse.ok(visiblePrices(service.updateWithDetails(id, product, true)));
        }
        if("selling".equals(product.getStatus()) && permissionGuard.hasPermission(permission(scope(existing.getSourceStatus()),"edit"))) { return ApiResponse.ok(visiblePrices(service.updateWithDetails(id,product))); }
        return ApiResponse.ok(visiblePrices(service.sourceTransition(id,"offShelf".equals(product.getOperation()) ? "offShelf" : product.getStatus(),product.getOffShelfReason(),product.getOffShelfDetail())));
      }
      permissionGuard.requirePermission(permission(scope(existing.getSourceStatus()),"edit"));
      return ApiResponse.ok(visiblePrices(editForm
          ? service.updateWithDetails(id, product, true)
          : service.updateWithDetails(id, product)));
    }
    if (existing.isSourceUnavailable() || Boolean.TRUE.equals(existing.getOperationsDeleted())) {
      throw new IllegalArgumentException("该商品已被供应链删除或运营已彻底删除，不能执行此操作");
    }
    String source = scope(existing.getStatus());
    if (!java.util.Objects.equals(existing.getStatus(), product.getStatus())) {
      String action = transitionAction(existing.getStatus(), product.getStatus());
      permissionGuard.requireAnyPermission(permission(source, action), permission(source, "batch-" + action));
      return ApiResponse.ok(service.updateOperationWithDetails(id, product, false));
    }
    if (!"warehouse".equals(source) && !"selling".equals(source)) {
      throw new org.springframework.security.access.AccessDeniedException("当前状态不允许编辑商品");
    }
    permissionGuard.requirePermission(permission(source, "edit"));
    return ApiResponse.ok(service.updateOperationWithDetails(id, product, true));
  }

  public record SourceCostEntry(Long skuId, BigDecimal costPrice) {}
  public record SourceCostsRequest(List<SourceCostEntry> variants) {
    public SourceCostsRequest {
      variants = variants == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(variants));
    }
  }

  @PutMapping("/{id}/source-costs")
  public ApiResponse<AccessoryProduct> updateSourceCosts(
      @PathVariable Long id, @RequestBody SourceCostsRequest request) {
    if (!isSupplyChain()) {
      throw new org.springframework.security.access.AccessDeniedException("此操作属于供应链协同系统");
    }
    permissionGuard.requireDataPermission();
    AccessoryProduct existing = service.getById(id);
    if (existing == null || "purged".equals(existing.getSourceStatus())) {
      throw new IllegalArgumentException("配件不存在或已被删除");
    }
    permissionGuard.requireData(existing);
    String scope = scope(existing.getSourceStatus());
    permissionGuard.requirePermission(permission(scope, "edit"));
    if (!List.of("warehouse", "selling").contains(scope)) {
      throw new IllegalArgumentException("当前状态不能修改成本价");
    }
    if (request == null || request.variants() == null) {
      throw new IllegalArgumentException("请完善每个规格的成本价");
    }
    Map<Long, BigDecimal> costs = new LinkedHashMap<>();
    for (SourceCostEntry entry : request.variants()) {
      if (entry == null || entry.skuId() == null || entry.costPrice() == null
          || costs.putIfAbsent(entry.skuId(), entry.costPrice()) != null) {
        throw new IllegalArgumentException("请完善每个规格的成本价");
      }
    }
    return ApiResponse.ok(visiblePrices(service.updateSourceCosts(id, costs)));
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requireAnyPermission(prefix() + ".delete",
        permission("recycle", "purge"), permission("recycle", "batch-purge"), permission("recycle", "clear"));
    permissionGuard.requireDataPermission();
    AccessoryProduct product = service.getById(id);
    if (product == null || (isSupplyChain() ? !"recycle".equals(product.getSourceStatus()) : (Boolean.TRUE.equals(product.getOperationsDeleted()) || (!"recycle".equals(product.getStatus()) && !product.isSourceUnavailable())))) {
      throw new IllegalArgumentException("只有回收站中的配件可以彻底删除");
    }
    permissionGuard.requireData(product);
    return ApiResponse.ok(service.removeById(id));
  }
  private boolean isSupplyChain() { return "supply-chain".equals(permissionGuard.identity().clientCode()); }
  private AccessoryProduct visiblePrices(AccessoryProduct product) {
    if (isSupplyChain() && product != null) {
      product.setGuidePrice(null);
      product.setGuidePrices(List.of());
      product.setMarkupPrices(List.of());
    }
    return product;
  }
  private String prefix() { return (isSupplyChain()?"supply-chain.":"admin.")+"accessory-management"; }
  private String permission(String scope, String action) {
    if (isSupplyChain() && "warehouse".equals(scope) && "batch-shelf".equals(action)) {
      return permissionGuard.hasPermission(prefix() + ".warehouse.batch-shelf")
          ? prefix() + ".warehouse.batch-shelf" : prefix() + ".batch-shelf";
    }
    return prefix() + "." + scope + "." + action;
  }

  private static String scope(String status) {
    if (status == null) {
      return "warehouse";
    }
    return switch (status) {
      case "soldOut" -> "sold-out";
      default -> status;
    };
  }

  private void requireProductFormPermission() {
    permissionGuard.requireAnyPermission(prefix() + ".create", prefix() + ".edit",
        prefix() + ".publish",
        permission("warehouse", "edit"), permission("selling", "edit"));
  }

  private static String transitionAction(String source, String target) {
    if ("warehouse".equals(source) && "selling".equals(target)) {
      return "shelf";
    }
    if ("selling".equals(source) && "warehouse".equals(target)) {
      return "off-shelf";
    }
    if ("recycle".equals(source) && "warehouse".equals(target)) {
      return "restore";
    }
    if (("warehouse".equals(source) || "selling".equals(source)) && "recycle".equals(target)) {
      return "delete";
    }
    throw new org.springframework.security.access.AccessDeniedException("无权执行当前状态操作");
  }

}
