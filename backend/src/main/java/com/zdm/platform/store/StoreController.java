package com.zdm.platform.store;

import com.zdm.platform.common.ApiResponse;
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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/stores")
public class StoreController {
  private static final String PERMISSION_PREFIX = "admin.tenant.tenant-store-management";

  private final StoreService storeService;
  private final PermissionGuard permissionGuard;

  public StoreController(StoreService storeService, PermissionGuard permissionGuard) {
    this.storeService = storeService;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<Store>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(storeService.listForCurrentAdmin());
  }

  @PostMapping
  public ApiResponse<Store> create(@Valid @RequestBody Store store) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    store.setId(null);
    storeService.createStore(store);
    return ApiResponse.ok(store);
  }

  @PutMapping("/{id}")
  public ApiResponse<Store> update(@PathVariable Long id, @Valid @RequestBody Store store) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    return ApiResponse.ok(storeService.updateStore(id, store));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    return ApiResponse.ok(storeService.deleteStore(id));
  }
}
