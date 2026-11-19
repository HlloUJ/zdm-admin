package com.zdm.platform.inventory;

import com.zdm.platform.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Map;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/admin/store-product-center")
public class StoreSelectionController {
  public record Add(@NotBlank String context, @NotBlank String type, @NotNull Long productId) {}
  public record Join(@NotBlank String context, @NotBlank String requestId) {}
  public record Selection(StoreSelectionCatalog.Page page, Map<String, Long> counts) {
    public Selection { counts = Map.copyOf(counts); }
  }
  private final StoreSelectionCatalog catalog;
  private final StoreSelectionService service;
  public StoreSelectionController(StoreSelectionCatalog catalog, StoreSelectionService service) { this.catalog = catalog; this.service = service; }
  @GetMapping("/context")
  public ApiResponse<StoreSelectionCatalog.Context> context() { return ApiResponse.ok(catalog.context()); }
  @GetMapping("/categories")
  public ApiResponse<List<StoreSelectionCatalog.Category>> categories(@RequestParam String context) { return ApiResponse.ok(catalog.categories(context)); }
  @GetMapping("/products")
  public ApiResponse<StoreSelectionCatalog.Page> products(@RequestParam String context,
      @RequestParam(required = false) String keyword, @RequestParam(required = false) List<String> types,
      @RequestParam(required = false) List<String> states, @RequestParam(required = false) String categoryType,
      @RequestParam(required = false) Long categoryId, @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "20") int pageSize) {
    return ApiResponse.ok(catalog.products(context, keyword, types, states, categoryType, categoryId, page, pageSize));
  }
  @GetMapping("/products/{type}/{id}")
  public ApiResponse<StoreSelectionCatalog.Detail> detail(@RequestParam String context, @PathVariable String type, @PathVariable Long id) {
    return ApiResponse.ok(catalog.detail(context, type, id));
  }
  @GetMapping("/selection")
  public ApiResponse<Selection> selection(@RequestParam String context, @RequestParam(defaultValue = "finished") String type,
      @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "5") int pageSize) {
    return ApiResponse.ok(new Selection(catalog.selection(context, type, page, pageSize), catalog.counts(context)));
  }
  @PostMapping("/selection")
  public ApiResponse<Boolean> add(@Valid @RequestBody Add input) { service.add(input.context(), input.type(), input.productId()); return ApiResponse.ok(true); }
  @DeleteMapping("/selection/{id}")
  public ApiResponse<Boolean> remove(@RequestParam String context, @PathVariable Long id) { service.remove(context, id); return ApiResponse.ok(true); }
  @PostMapping("/join-batches")
  public ApiResponse<StoreSelectionService.Result> join(@Valid @RequestBody Join input) { return ApiResponse.ok(service.join(input.context(), input.requestId())); }
  @GetMapping("/join-batches/{id}")
  public ApiResponse<StoreSelectionService.Result> result(@RequestParam String context, @PathVariable Long id) { return ApiResponse.ok(service.result(context, id)); }
}
