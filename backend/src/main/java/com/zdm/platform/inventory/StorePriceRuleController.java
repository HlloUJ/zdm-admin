package com.zdm.platform.inventory;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.transaction.annotation.Transactional;
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
@RequestMapping("/api/admin/store-price-rules")
public class StorePriceRuleController {
  public record SaveRequest(Long categoryId, Long roleId, @NotNull BigDecimal coefficient) {}
  public record BatchRequest(@NotNull @Size(min = 1, max = 200) List<@NotNull Long> categoryIds,
      @NotNull BigDecimal coefficient) {
    public BatchRequest {
      categoryIds = categoryIds == null ? null
          : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(categoryIds));
    }
  }
  public record StatusRequest(@NotNull String status) {}
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
  public ApiResponse<List<StorePriceRuleService.Rule>> list(@PathVariable String kind, @RequestParam(defaultValue = "finished") String scope) {
    require(kind, scope, "view");
    return ApiResponse.ok(service.list(kind, scope));
  }

  @GetMapping("/price/categories")
  public ApiResponse<List<StorePriceRuleService.CategoryOption>> categories(@RequestParam(defaultValue = "finished") String scope) {
    require("price", scope, "view");
    return ApiResponse.ok(service.categories(scope));
  }

  @GetMapping("/discount/roles")
  public ApiResponse<List<StorePriceRuleService.RoleOption>> roles(@RequestParam(defaultValue = "finished") String scope) {
    require("discount", scope, "view");
    return ApiResponse.ok(service.roles());
  }

  @PostMapping("/{kind}")
  public ApiResponse<StorePriceRuleService.Rule> create(@PathVariable String kind,
      @RequestParam(defaultValue = "finished") String scope, @Valid @RequestBody SaveRequest request) {
    require(kind, scope, "create");
    return ApiResponse.ok(service.save(kind, scope, null, request.categoryId(), request.roleId(), request.coefficient()));
  }

  @Transactional
  @PostMapping("/price/batch")
  public ApiResponse<List<StorePriceRuleService.Rule>> batch(@RequestParam String scope,
      @Valid @RequestBody BatchRequest request) {
    require("price", scope, "batch-set");
    if (request.categoryIds() != null) {
      var existing = service.list("price", scope);
      for (Long categoryId : request.categoryIds()) {
        boolean hasRule = existing.stream().anyMatch(rule -> java.util.Objects.equals(categoryId, rule.categoryId()));
        require("price", scope, hasRule ? "edit" : "create");
      }
    }
    return ApiResponse.ok(service.saveBatch(scope, request.categoryIds(), request.coefficient()));
  }

  @PutMapping("/{kind}/{id}")
  public ApiResponse<StorePriceRuleService.Rule> edit(@PathVariable String kind, @PathVariable Long id,
      @RequestParam(defaultValue = "finished") String scope, @Valid @RequestBody SaveRequest request) {
    require(kind, scope, "edit");
    return ApiResponse.ok(service.save(kind, scope, id, request.categoryId(), request.roleId(), request.coefficient()));
  }

  @PutMapping("/{kind}/{id}/status")
  public ApiResponse<StorePriceRuleService.Rule> status(@PathVariable String kind, @PathVariable Long id,
      @RequestParam(defaultValue = "finished") String scope, @Valid @RequestBody StatusRequest request) {
    require(kind, scope, "toggle-status");
    return ApiResponse.ok(service.status(kind, scope, id, request.status()));
  }

  @DeleteMapping("/{kind}/{id}")
  public ApiResponse<Boolean> delete(@PathVariable String kind, @PathVariable Long id, @RequestParam(defaultValue = "finished") String scope) {
    require(kind, scope, "delete");
    service.delete(kind, scope, id);
    return ApiResponse.ok(true);
  }
}
