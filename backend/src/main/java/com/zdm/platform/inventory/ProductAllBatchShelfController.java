package com.zdm.platform.inventory;

import com.zdm.platform.common.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin")
public class ProductAllBatchShelfController {
  private final ProductAllBatchShelfService service;
  public ProductAllBatchShelfController(ProductAllBatchShelfService service) { this.service = service; }
  @PostMapping("/{resource:finished-products|accessory-products|slabs|store-finished-products|store-accessory-products}/all-batch-shelf")
  public ApiResponse<OperationsBatchShelfService.Result> shelf(@PathVariable String resource,
      @Valid @RequestBody OperationsBatchShelfController.Request request) {
    return ApiResponse.ok(service.shelf(resource, request.ids()));
  }
}
