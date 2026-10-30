package com.zdm.platform.inventory;

import com.zdm.platform.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.util.List;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin")
public class OperationsBatchShelfController {
  private final OperationsBatchShelfService service;
  public OperationsBatchShelfController(OperationsBatchShelfService service) { this.service = service; }
  public record Request(@NotEmpty List<@NotNull @Positive Long> ids) {
    public Request { ids = ids == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(ids)); }
  }
  @PostMapping("/{resource:finished-products|accessory-products|slabs}/batch-shelf")
  public ApiResponse<OperationsBatchShelfService.Result> shelf(@PathVariable String resource, @Valid @RequestBody Request request) {
    return ApiResponse.ok(service.shelf(resource, request.ids()));
  }
}
