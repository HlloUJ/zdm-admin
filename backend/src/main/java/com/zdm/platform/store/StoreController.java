package com.zdm.platform.store;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/stores")
public class StoreController {
  private static final String PERMISSION_PREFIX = "admin.tenant.tenant-store-management";

  private final StoreService storeService;
  private final StoreLevelService storeLevelService;
  private final PermissionGuard permissionGuard;

  public StoreController(
      StoreService storeService,
      StoreLevelService storeLevelService,
      PermissionGuard permissionGuard) {
    this.storeService = storeService;
    this.storeLevelService = storeLevelService;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<Store>> list(@RequestParam(defaultValue = "operating") String scope) {
    if (!"operating".equals(scope) && !"archived".equals(scope)) {
      throw new IllegalArgumentException("门店列表类型错误");
    }
    permissionGuard.requirePermission(PERMISSION_PREFIX + "." + scope + ".view");
    return ApiResponse.ok(storeService.listForCurrentAdmin("archived".equals(scope)));
  }

  @GetMapping("/level-options")
  public ApiResponse<List<StoreLevel>> listLevelOptions() {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".operating.view");
    return ApiResponse.ok(storeLevelService.listEnabled());
  }

  @PostMapping
  public ApiResponse<Store> create(@Valid @RequestBody Store store) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".operating.create");
    store.setId(null);
    storeService.createStore(store);
    return ApiResponse.ok(store);
  }

  @PutMapping("/{id}")
  public ApiResponse<Store> update(@PathVariable Long id, @Valid @RequestBody Store store) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".operating.edit");
    return ApiResponse.ok(storeService.updateStore(id, store));
  }

  @PatchMapping("/{id}/level")
  public ApiResponse<Store> updateLevel(
      @PathVariable Long id, @Valid @RequestBody StoreLevelSelectionRequest request) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".operating.edit-level");
    return ApiResponse.ok(storeService.updateLevel(id, request.storeLevelId()));
  }

  @PatchMapping("/{id}/archive")
  public ApiResponse<Store> archive(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".operating.archive");
    return ApiResponse.ok(storeService.archiveStore(id));
  }

  @PatchMapping("/{id}/restore")
  public ApiResponse<Store> restore(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".archived.restore");
    return ApiResponse.ok(storeService.restoreStore(id));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".archived.delete");
    return ApiResponse.ok(storeService.deleteStore(id));
  }
}
