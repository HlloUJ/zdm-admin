package com.zdm.platform.inventory;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.media.MediaStorageService;
import com.zdm.platform.media.MediaUploadResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import java.util.Objects;
import org.springframework.format.annotation.DateTimeFormat;
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
  private final SlabOperationLogService operationLogService;

  public SlabInventoryController(
      SlabInventoryService service,
      PermissionGuard permissionGuard,
      MediaAssetService mediaAssetService,
      SlabOperationLogService operationLogService) {
    super(service, permissionGuard, PERMISSION_PREFIX);
    this.service = service;
    this.permissionGuard = permissionGuard;
    this.mediaAssetService = mediaAssetService;
    this.operationLogService = operationLogService;
  }

  @PostMapping("/images")
  public ApiResponse<MediaUploadResponse> uploadImage(@RequestParam("file") MultipartFile file) {
    permissionGuard.requireAnyPermission(
        prefix() + ".create",
        prefix() + ".edit",
        permission("warehouse", "publish"),
        permission("selling", "publish"),
        permission("warehouse", "edit"),
        permission("selling", "edit"),
        permission("off-shelf", "edit"));
    return ApiResponse.ok(mediaAssetService.upload(file, MediaStorageService.defaultImageSizeLimit()));
  }

  @DeleteMapping("/images")
  public ApiResponse<Boolean> deleteUnreferencedImage(@RequestParam Long mediaId) {
    permissionGuard.requireAnyPermission(
        prefix() + ".create",
        prefix() + ".edit",
        prefix() + ".delete",
        permission("warehouse", "publish"),
        permission("selling", "publish"),
        permission("warehouse", "edit"),
        permission("selling", "edit"),
        permission("off-shelf", "edit"));
    return ApiResponse.ok(service.cleanupTemporaryMedia(mediaId));
  }

  @GetMapping("/form-options")
  public ApiResponse<SlabPublishOptions> formOptions() {
    permissionGuard.requireView(prefix());
    return ApiResponse.ok(service.listPublishOptions());
  }

  @Override
  @GetMapping
  public ApiResponse<List<SlabInventory>> list() {
    permissionGuard.requireView(prefix());
    return ApiResponse.ok(permissionGuard.filterData(service.listWithPrices()));
  }

  @GetMapping("/{id}")
  public ApiResponse<SlabInventory> detail(@PathVariable Long id) {
    permissionGuard.requireView(prefix());
    permissionGuard.requireAnyPermission(permission("warehouse", "detail"), permission("selling", "detail"),
        permission("off-shelf", "detail"), permission("sold-out", "detail"), permission("recycle", "detail"));
    permissionGuard.requireDataPermission();
    SlabInventory item = service.visibleDetail(id);
    if (item == null) { throw new IllegalArgumentException("大板不存在或不可访问"); }
    String scope = statusScope(isSupplyChain() ? item.getSourceStatus() : item.getStatus());
    permissionGuard.requireAnyPermission(prefix() + ".view", permission(scope, "view"));
    permissionGuard.requirePermission(permission(scope, "detail"));
    return ApiResponse.ok(item);
  }

  @GetMapping("/operation-logs")
  public ApiResponse<SlabOperationLogPage> listOperationLogs(
      @RequestParam(required = false) String keyword,
      @RequestParam(required = false) String operationType,
      @RequestParam(required = false) String operatorName,
      @RequestParam(required = false)
      @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
      @RequestParam(required = false)
      @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int pageSize) {
    permissionGuard.requirePermission(prefix() + ".operation-log.view");
    return ApiResponse.ok(operationLogService.listPage(
        keyword, operationType, operatorName, startDate, endDate, page, pageSize));
  }

  @Override
  @PostMapping
  public ApiResponse<SlabInventory> create(@Valid @RequestBody SlabInventory inventory) {
    permissionGuard.requireAnyPermission(permission("warehouse","publish"),permission("selling","publish"));
    if(isSupplyChain() && "selling".equals(inventory.getStatus()) && !"接口获取".equals(inventory.getPublisherType())) { permissionGuard.requireAnyPermission(permission("warehouse","shelf"),permission("selling","publish")); }
    return ApiResponse.ok(service.createWithPrices(inventory));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<SlabInventory> update(
      @PathVariable Long id, @Valid @RequestBody SlabInventory inventory) {
    SlabInventory existing = service.getById(id);
    if(existing==null) { throw new IllegalArgumentException("大板不存在"); }
    String scope = statusScope(isSupplyChain()?existing.getSourceStatus():existing.getStatus());
    if (!List.of("warehouse","selling").contains(scope)) { throw new IllegalArgumentException("当前状态不能编辑"); }
    permissionGuard.requirePermission(permission(scope,isSupplyChain()?"edit":"price"));
    if(isSupplyChain() && !Objects.equals(existing.getSourceStatus(),inventory.getStatus())) { requireStatusTransition(existing.getSourceStatus(),inventory.getStatus()); }
    return ApiResponse.ok(service.updateWithPrices(id, inventory));
  }

  public record ActionCheckRequest(List<Long> ids, String action) {
    public ActionCheckRequest {
      ids = ids == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(ids));
    }
  }

  @PostMapping("/action-check")
  public ApiResponse<Boolean> checkAction(@RequestBody ActionCheckRequest request) {
    if ("clearRecycle".equals(request.action())) {
      permissionGuard.requirePermission(permission("recycle", "clear"));
      service.checkClearRecycle();
      return ApiResponse.ok(true);
    }
    if (request.ids() == null || request.ids().isEmpty() || request.ids().contains(null)) {
      throw new IllegalArgumentException("请选择大板");
    }
    String action = request.action();
    if (action == null || !List.of("shelf", "offShelf", "restore", "delete", "purge").contains(action)) {
      throw new IllegalArgumentException("不支持的操作");
    }
    for (Long id : request.ids().stream().distinct().toList()) {
      SlabInventory item = service.getById(id);
      if (item == null) { throw new IllegalArgumentException("大板不存在或已被删除"); }
      com.zdm.platform.security.DataScope.requireAccess(permissionGuard.identity(), item.getCreatedByAccountId());
      String state = isSupplyChain() ? item.getSourceStatus() : item.getStatus();
      switch (action) {
        case "shelf" -> requireStatusTransition(state, "selling");
        case "offShelf" -> requireStatusTransition(state, "offShelf");
        case "restore" -> requireStatusTransition(state, "warehouse");
        case "delete" -> permissionGuard.requireAnyPermission(prefix() + ".delete", permission(statusScope(state), "delete"));
        case "purge" -> permissionGuard.requireAnyPermission(prefix() + ".delete", permission("recycle", "purge"), permission("recycle", "batch-purge"), permission("recycle", "clear"));
        default -> throw new IllegalArgumentException("不支持的操作");
      }
    }
    service.checkAction(request.ids(), action);
    return ApiResponse.ok(true);
  }

  @PutMapping("/batch-status")
  public ApiResponse<Boolean> updateBatchStatus(@Valid @RequestBody SlabInventoryBatchStatusRequest request) {
    service.listByIds(request.ids()).stream()
        .map(item -> isSupplyChain()?item.getSourceStatus():item.getStatus())
        .filter(Objects::nonNull)
        .distinct()
        .forEach(status -> requireStatusTransition(status, request.status()));
    service.updateStatuses(request.ids(), request.status(), request.reason(), request.detail());
    return ApiResponse.ok(true);
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requireAnyPermission(
        prefix() + ".delete",
        permission("recycle", "purge"),
        permission("recycle", "batch-purge"),
        permission("recycle", "clear"));
    SlabInventory inventory = service.getById(id);
    if (inventory == null || (isSupplyChain() ? !"recycle".equals(inventory.getSourceStatus()) : (Boolean.TRUE.equals(inventory.getOperationsDeleted()) || (!"recycle".equals(inventory.getStatus()) && !inventory.isSourceUnavailable())))) {
      throw new IllegalArgumentException("只有回收站中的大板可以彻底删除");
    }
    return ApiResponse.ok(service.purgeFromRecycle(id));
  }

  @DeleteMapping("/batch-purge")
  public ApiResponse<Boolean> batchPurge(@RequestBody List<Long> ids) {
    permissionGuard.requireAnyPermission(
        permission("recycle", "batch-purge"),
        permission("recycle", "clear"));
    return ApiResponse.ok(service.purgeFromRecycleBatch(ids));
  }

  @DeleteMapping("/clear-recycle")
  public ApiResponse<Integer> clearRecycle() {
    permissionGuard.requirePermission(permission("recycle", "clear"));
    return ApiResponse.ok(service.clearRecycle());
  }

  @PostMapping("/{id}/delete")
  public ApiResponse<Boolean> deleteFromManagement(
      @PathVariable Long id, @Valid @RequestBody(required = false) SlabDeleteRequest request) {
    SlabInventory inventory = service.getById(id);
    if (inventory == null) {
      throw new IllegalArgumentException("大板不存在或已被删除");
    }
    String scope = statusScope(isSupplyChain()?inventory.getSourceStatus():inventory.getStatus());
    if (!"warehouse".equals(scope) && !"off-shelf".equals(scope)) {
      throw new IllegalArgumentException("只有仓库中或已下架的大板可以删除");
    }
    permissionGuard.requireAnyPermission(prefix() + ".delete", permission(scope, "delete"));
    return ApiResponse.ok(service.deleteFromManagement(
        id, request == null ? null : request.reason(), request == null ? null : request.detail()));
  }

  private void requireStatusTransition(String sourceStatus, String targetStatus) {
    if ("warehouse".equals(sourceStatus) && "selling".equals(targetStatus)) {
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
    permissionGuard.requirePermission(prefix() + ".edit");
  }

  private void requireEditOr(String... permissions) {
    String[] candidates = new String[permissions.length + 1];
    candidates[0] = prefix() + ".edit";
    System.arraycopy(permissions, 0, candidates, 1, permissions.length);
    permissionGuard.requireAnyPermission(candidates);
  }

  private String statusScope(String status) {
    return switch (status == null ? "" : status) {
      case "warehouse", "selling", "recycle" -> status;
      case "offShelf" -> "off-shelf";
      case "soldOut" -> "sold-out";
      default -> null;
    };
  }

  private boolean isSupplyChain() { return "supply-chain".equals(permissionGuard.identity().clientCode()); }
  private String prefix() { return (isSupplyChain()?"supply-chain.":"admin.")+"slab-management"; }
  private String permission(String scope, String action) {
    return prefix() + "." + scope + "." + action;
  }
}
