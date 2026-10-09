package com.zdm.platform.inventory;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
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

@RestController
@RequestMapping("/api/admin/store-finished-products")
public class StoreFinishedProductController {
  public record SelectRequest(@NotEmpty List<@NotNull Long> productIds) {
    public SelectRequest {
      productIds = productIds == null ? null
          : Collections.unmodifiableList(new ArrayList<>(productIds));
    }
  }
  public record TransitionRequest(@NotNull String target, String reason, String detail) {}
  public record BatchRequest(@NotEmpty List<@NotNull Long> ids, @NotNull String target,
      String reason, String detail) {
    public BatchRequest {
      ids = ids == null ? null : Collections.unmodifiableList(new ArrayList<>(ids));
    }
  }
  public record RolePriceRequest(BigDecimal price, boolean followConfiguration) {}

  private static final String PREFIX = "store.finished-stock-management";
  private final StoreFinishedProductService service;
  private final PermissionGuard guard;

  public StoreFinishedProductController(StoreFinishedProductService service, PermissionGuard guard) {
    this.service = service;
    this.guard = guard;
  }

  @GetMapping("/categories")
  public ApiResponse<List<StoreFinishedProductService.PoolCategory>> categories() {
    guard.requireView(PREFIX);
    guard.requireDataPermission();
    return ApiResponse.ok(service.listCategories());
  }

  @GetMapping("/pool-categories")
  public ApiResponse<List<StoreFinishedProductService.PoolCategory>> poolCategories() {
    guard.requirePermission(PREFIX + ".warehouse.select");
    guard.requireDataPermission();
    return ApiResponse.ok(service.poolCategories());
  }

  @GetMapping("/pool")
  public ApiResponse<List<StoreFinishedProductService.PoolProduct>> pool() {
    guard.requirePermission(PREFIX + ".warehouse.select");
    guard.requireDataPermission();
    return ApiResponse.ok(service.pool());
  }

  @GetMapping("/pool/{id}")
  public ApiResponse<StoreFinishedProductService.PoolDetail> poolDetail(@PathVariable Long id) {
    guard.requirePermission(PREFIX + ".warehouse.select");
    guard.requireDataPermission();
    return ApiResponse.ok(service.poolDetail(id));
  }

  @PostMapping("/select")
  public ApiResponse<List<StoreFinishedProductService.ProductView>> select(
      @Valid @RequestBody SelectRequest request) {
    guard.requirePermission(PREFIX + ".warehouse.select");
    guard.requireDataPermission();
    return ApiResponse.ok(service.select(request.productIds()));
  }

  @GetMapping
  public ApiResponse<List<StoreFinishedProductService.ProductView>> list() {
    guard.requireView(PREFIX);
    guard.requireDataPermission();
    return ApiResponse.ok(service.list().stream().filter(product ->
        guard.hasPermission(PREFIX + "." + scope(product.effectiveStatus()) + ".view")).toList());
  }

  @GetMapping("/{id}")
  public ApiResponse<StoreFinishedProductService.ProductView> detail(@PathVariable Long id) {
    guard.requireView(PREFIX);
    guard.requireDataPermission();
    var product = service.detail(id);
    String scope = scope(product.effectiveStatus());
    guard.requirePermission(PREFIX + "." + scope + ".view");
    if (!product.sourceUnavailable()) {
      guard.requirePermission(PREFIX + "." + scope + "."
          + (List.of("warehouse", "selling").contains(scope) ? "edit" : "detail"));
    }
    return ApiResponse.ok(product);
  }

  @GetMapping("/{id}/skus/{skuId}/minimum-sale-price")
  public ApiResponse<StoreFinishedProductService.EffectiveMinimumPrice> currentMinimumPrice(
      @PathVariable Long id, @PathVariable Long skuId) {
    guard.requireDataPermission();
    var product = service.detail(id);
    guard.requirePermission(PREFIX + "." + scope(product.effectiveStatus()) + ".view");
    guard.requirePermission(PREFIX + "." + scope(product.effectiveStatus()) + ".detail");
    return ApiResponse.ok(service.currentEmployeeMinimumPrice(id, skuId));
  }

  @PutMapping("/{id}/status")
  public ApiResponse<StoreFinishedProductService.ProductView> status(@PathVariable Long id,
      @Valid @RequestBody TransitionRequest request) {
    guard.requireDataPermission();
    var product = service.detail(id);
    requireTransition(product, request.target(), false);
    return ApiResponse.ok(service.changeStatus(id, request.target(), request.reason(), request.detail()));
  }

  @PutMapping("/status/batch")
  public ApiResponse<List<StoreFinishedProductService.ProductView>> batch(
      @Valid @RequestBody BatchRequest request) {
    guard.requireDataPermission();
    requireUniqueBatchIds(request.ids());
    var products = request.ids().stream().map(service::detail).toList();
    products.forEach(product -> requireTransition(product, request.target(), true));
    return ApiResponse.ok(service.changeStatusBatch(request.ids(), request.target(),
        request.reason(), request.detail()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> purge(@PathVariable Long id) {
    guard.requireDataPermission();
    var product = service.detail(id);
    if (product.sourceUnavailable()) {
      guard.requirePermission(PREFIX + "." + scope(product.effectiveStatus()) + ".view");
    } else {
      guard.requirePermission(PREFIX + ".recycle.purge");
    }
    service.purge(id);
    return ApiResponse.ok(true);
  }

  @DeleteMapping("/batch")
  public ApiResponse<Boolean> purgeBatch(@Valid @RequestBody SelectRequest request) {
    guard.requirePermission(PREFIX + ".recycle.batch-purge");
    guard.requireDataPermission();
    requireUniqueBatchIds(request.productIds());
    request.productIds().forEach(id -> {
      var product = service.detail(id);
      if (!"recycle".equals(product.status()) && !product.sourceUnavailable()) {
        throw new IllegalArgumentException("只能批量彻底删除回收站或来源失效商品");
      }
    });
    service.purgeBatch(request.productIds());
    return ApiResponse.ok(true);
  }

  @DeleteMapping("/recycle")
  public ApiResponse<Boolean> clearRecycle() {
    guard.requirePermission(PREFIX + ".recycle.clear");
    guard.requireDataPermission();
    service.clearRecycle();
    return ApiResponse.ok(true);
  }

  @PutMapping("/{id}/skus/{skuId}/roles/{roleId}/price")
  public ApiResponse<StoreFinishedProductService.ProductView> rolePrice(@PathVariable Long id,
      @PathVariable Long skuId, @PathVariable Long roleId,
      @Valid @RequestBody RolePriceRequest request) {
    guard.requireDataPermission();
    requireEdit(service.detail(id));
    return ApiResponse.ok(service.saveRolePrice(id, skuId, roleId, request.price(),
        request.followConfiguration()));
  }

  @GetMapping("/operation-logs")
  public ApiResponse<StoreFinishedProductService.LogPage> logs(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "") String operationType,
      @RequestParam(defaultValue = "") String operatorName,
      @RequestParam(defaultValue = "") String startDate,
      @RequestParam(defaultValue = "") String endDate,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int pageSize) {
    guard.requirePermission(PREFIX + ".operation-log.view");
    guard.requireDataPermission();
    return ApiResponse.ok(service.logPage(keyword, operationType, operatorName,
        startDate, endDate, page, pageSize));
  }

  @GetMapping("/operation-logs/{id}")
  public ApiResponse<StoreFinishedProductService.LogEntry> logDetail(@PathVariable Long id) {
    guard.requirePermission(PREFIX + ".operation-log.view");
    guard.requireDataPermission();
    return ApiResponse.ok(service.logDetail(id));
  }

  private static void requireUniqueBatchIds(List<Long> ids) {
    if (ids.size() > 100 || ids.stream().distinct().count() != ids.size()) {
      throw new IllegalArgumentException("批量操作最多 100 件且不能重复");
    }
  }

  private void requireEdit(StoreFinishedProductService.ProductView product) {
    String scope = scope(product.effectiveStatus());
    guard.requirePermission(PREFIX + "." + scope + ".edit");
  }

  private void requireTransition(StoreFinishedProductService.ProductView product,
      String target, boolean batch) {
    String current = scope(product.effectiveStatus());
    String action = switch (target) {
      case "selling" -> "shelf";
      case "offShelf" -> "off-shelf";
      case "warehouse" -> "restore";
      case "recycle" -> "delete";
      default -> throw new IllegalArgumentException("不支持的门店商品状态");
    };
    guard.requirePermission(PREFIX + "." + current + "." + (batch ? "batch-" : "") + action);
  }

  private static String scope(String status) {
    return switch (status) {
      case "offShelf" -> "off-shelf";
      case "soldOut" -> "sold-out";
      default -> status;
    };
  }
}
