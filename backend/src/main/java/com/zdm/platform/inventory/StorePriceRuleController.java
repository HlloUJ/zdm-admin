package com.zdm.platform.inventory;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
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

  @PostMapping("/{kind}/batch")
  public ApiResponse<List<StorePriceRuleService.Rule>> batch(@PathVariable String kind, @RequestParam String scope,
      @Valid @RequestBody BatchRequest request) {
    require(kind, scope, "batch-set");
    return ApiResponse.ok(service.saveBatch(kind, scope, request.targetIds(), request.coefficient()));
  }
}
