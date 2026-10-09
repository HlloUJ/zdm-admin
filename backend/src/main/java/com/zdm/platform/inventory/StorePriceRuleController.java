package com.zdm.platform.inventory;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/store-price-rules")
public class StorePriceRuleController {
  public record SaveRequest(Long categoryId, Long roleId, @NotNull BigDecimal coefficient) {}
  public record StatusRequest(@NotNull String status) {}
  private final StorePriceRuleService service;
  private final PermissionGuard guard;

  public StorePriceRuleController(StorePriceRuleService service, PermissionGuard guard) {
    this.service = service;
    this.guard = guard;
  }

  private void require(String kind, String action) {
    if (!List.of("price", "discount").contains(kind)) {
      throw new IllegalArgumentException("配置类型不正确");
    }
    guard.requirePermission("store.price-configuration." + kind + "." + action);
    guard.requireDataPermission();
  }

  @GetMapping("/{kind}")
  public ApiResponse<List<StorePriceRuleService.Rule>> list(@PathVariable String kind) {
    require(kind, "view");
    return ApiResponse.ok(service.list(kind));
  }

  @GetMapping("/price/categories")
  public ApiResponse<List<StorePriceRuleService.CategoryOption>> categories() {
    require("price", "view");
    return ApiResponse.ok(service.categories());
  }

  @GetMapping("/discount/roles")
  public ApiResponse<List<StorePriceRuleService.RoleOption>> roles() {
    require("discount", "view");
    return ApiResponse.ok(service.roles());
  }

  @PostMapping("/{kind}")
  public ApiResponse<StorePriceRuleService.Rule> create(@PathVariable String kind,
      @Valid @RequestBody SaveRequest request) {
    require(kind, "create");
    return ApiResponse.ok(service.save(kind, null, request.categoryId(), request.roleId(), request.coefficient()));
  }

  @PutMapping("/{kind}/{id}")
  public ApiResponse<StorePriceRuleService.Rule> edit(@PathVariable String kind, @PathVariable Long id,
      @Valid @RequestBody SaveRequest request) {
    require(kind, "edit");
    return ApiResponse.ok(service.save(kind, id, request.categoryId(), request.roleId(), request.coefficient()));
  }

  @PutMapping("/{kind}/{id}/status")
  public ApiResponse<StorePriceRuleService.Rule> status(@PathVariable String kind, @PathVariable Long id,
      @Valid @RequestBody StatusRequest request) {
    require(kind, "toggle-status");
    return ApiResponse.ok(service.status(kind, id, request.status()));
  }

  @DeleteMapping("/{kind}/{id}")
  public ApiResponse<Boolean> delete(@PathVariable String kind, @PathVariable Long id) {
    require(kind, "delete");
    service.delete(kind, id);
    return ApiResponse.ok(true);
  }
}
