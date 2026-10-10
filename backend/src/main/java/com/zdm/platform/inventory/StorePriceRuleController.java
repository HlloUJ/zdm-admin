package com.zdm.platform.inventory;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/store-price-rules")
public class StorePriceRuleController {
  public record BatchRequest(@NotNull @Size(min = 1, max = 200) List<@NotNull Long> targetIds,
      @NotNull BigDecimal coefficient) {
    public BatchRequest {
      targetIds = targetIds == null ? null
          : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(targetIds));
    }
  }
  public record ClearPriceRequest(@NotNull @Size(min = 1, max = 200) List<@NotNull Long> targetIds) {
    public ClearPriceRequest {
      targetIds = targetIds == null ? null
          : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(targetIds));
    }
  }
  public record PriceChange(@NotNull Long categoryId, BigDecimal coefficient) {}
  public record SavePricesRequest(@NotNull @Size(min = 1, max = 200) List<@NotNull @Valid PriceChange> changes) {
    public SavePricesRequest {
      changes = changes == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(changes));
    }
  }
  public record CreateDiscountRequest(@NotNull Long roleId, @NotNull BigDecimal coefficient) {}

  @PostMapping("/discount")
  public ApiResponse<List<StorePriceRuleService.Rule>> createDiscount(@RequestParam String scope,
      @Valid @RequestBody CreateDiscountRequest request) {
    require("discount", scope, "create");
    return ApiResponse.ok(service.createDiscount(scope, request.roleId(), request.coefficient()));
  }

  public record DiscountStatusRequest(@NotNull @jakarta.validation.constraints.Pattern(regexp = "enabled|disabled") String status) {}

  @PutMapping("/discount/{id}")
  public ApiResponse<List<StorePriceRuleService.Rule>> editDiscount(@PathVariable Long id, @RequestParam String scope,
      @Valid @RequestBody CreateDiscountRequest request) {
    require("discount", scope, "edit");
    return ApiResponse.ok(service.updateDiscount(id, scope, request.roleId(), request.coefficient()));
  }

  @PutMapping("/discount/{id}/status")
  public ApiResponse<List<StorePriceRuleService.Rule>> discountStatus(@PathVariable Long id, @RequestParam String scope,
      @Valid @RequestBody DiscountStatusRequest request) {
    require("discount", scope, "toggle-status");
    return ApiResponse.ok(service.updateDiscountStatus(id, scope, request.status()));
  }

  @DeleteMapping("/discount/{id}")
  public ApiResponse<List<StorePriceRuleService.Rule>> deleteDiscount(@PathVariable Long id, @RequestParam String scope) {
    require("discount", scope, "delete");
    return ApiResponse.ok(service.deleteDiscount(id, scope));
  }

  @PostMapping("/price/save")
  public ApiResponse<List<StorePriceRuleService.Rule>> savePrices(@RequestParam String scope,
      @Valid @RequestBody SavePricesRequest request) {
    require("price", scope, "batch-set");
    return ApiResponse.ok(service.savePrices(scope, request.changes().stream()
        .map(change -> new StorePriceRuleService.PriceChange(change.categoryId(), change.coefficient())).toList()));
  }
  private final StorePriceRuleService service;
  private final PermissionGuard guard;

  public StorePriceRuleController(StorePriceRuleService service, PermissionGuard guard) {
    this.service = service;
    this.guard = guard;
  }

  private void require(String kind, String scope, String action) {
    if (!List.of("price", "discount").contains(kind) || !List.of("finished", "accessory").contains(scope)) {
      throw new IllegalArgumentException("配置类型不正确");
    }
    guard.requirePermission("store.price-configuration." + kind + "." + scope + "." + action);
    guard.requireDataPermission();
  }

  @GetMapping("/{kind}")
  public ApiResponse<List<StorePriceRuleService.Rule>> list(@PathVariable String kind,
      @RequestParam(defaultValue = "finished") String scope) {
    require(kind, scope, "view");
    return ApiResponse.ok(service.list(kind, scope));
  }

  @GetMapping("/price/categories")
  public ApiResponse<List<StorePriceRuleService.CategoryOption>> categories(@RequestParam String scope) {
    require("price", scope, "view");
    return ApiResponse.ok(service.categories(scope));
  }

  @GetMapping("/discount/roles")
  public ApiResponse<List<StorePriceRuleService.RoleOption>> roles(@RequestParam String scope) {
    require("discount", scope, "view");
    return ApiResponse.ok(service.roles());
  }

  @PostMapping("/price/batch")
  public ApiResponse<List<StorePriceRuleService.Rule>> batch(@RequestParam String scope,
      @Valid @RequestBody BatchRequest request) {
    require("price", scope, "batch-set");
    return ApiResponse.ok(service.savePriceBatch(scope, request.targetIds(), request.coefficient()));
  }
  @PostMapping("/price/batch-clear")
  public ApiResponse<List<StorePriceRuleService.Rule>> clearPriceBatch(@RequestParam String scope,
      @Valid @RequestBody ClearPriceRequest request) {
    require("price", scope, "batch-set");
    return ApiResponse.ok(service.clearPriceBatch(scope, request.targetIds()));
  }

}
