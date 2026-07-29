package com.zdm.platform.store;

import com.zdm.platform.common.ApiResponse;
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
  private final StoreService storeService;

  public StoreController(StoreService storeService) {
    this.storeService = storeService;
  }

  @GetMapping
  public ApiResponse<List<Store>> list() {
    return ApiResponse.ok(storeService.listForCurrentAdmin());
  }

  @PostMapping
  public ApiResponse<Store> create(@Valid @RequestBody Store store) {
    store.setId(null);
    storeService.createStore(store);
    return ApiResponse.ok(store);
  }

  @PutMapping("/{id}")
  public ApiResponse<Store> update(@PathVariable Long id, @Valid @RequestBody Store store) {
    store.setId(id);
    storeService.updateById(store);
    return ApiResponse.ok(storeService.getById(id));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    return ApiResponse.ok(storeService.removeById(id));
  }
}
