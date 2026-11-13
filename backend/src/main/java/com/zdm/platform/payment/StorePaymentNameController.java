package com.zdm.platform.payment;

import com.zdm.platform.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.List;
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
@RequestMapping("/api/store/payment-names")
public class StorePaymentNameController {
  public record CreateRequest(String name) {}
  public record UpdateRequest(String name, @Min(1) long version) {}
  public record StatusRequest(@NotNull Boolean enabled, @Min(1) long version) {}
  private final StorePaymentNameService service;
  public StorePaymentNameController(StorePaymentNameService service) { this.service = service; }
  @GetMapping
  public ApiResponse<StorePaymentNameService.Page> list(@RequestParam(defaultValue="1") int page,
      @RequestParam(defaultValue="10") int pageSize) { return ApiResponse.ok(service.list(page, pageSize)); }
  @GetMapping("/options")
  public ApiResponse<List<StorePaymentNameService.Option>> options() { return ApiResponse.ok(service.options()); }
  @PostMapping
  public ApiResponse<StorePaymentNameService.Name> create(@RequestBody CreateRequest request) {
    return ApiResponse.ok(service.create(request.name()));
  }
  @PutMapping("/{id}")
  public ApiResponse<StorePaymentNameService.Name> update(@PathVariable long id, @Valid @RequestBody UpdateRequest request) {
    return ApiResponse.ok(service.update(id, request.name(), request.version()));
  }
  @PutMapping("/{id}/status")
  public ApiResponse<StorePaymentNameService.Name> status(@PathVariable long id, @Valid @RequestBody StatusRequest request) {
    return ApiResponse.ok(service.status(id, request.enabled(), request.version()));
  }
  @DeleteMapping("/{id}")
  public ApiResponse<Void> delete(@PathVariable long id, @RequestParam long version) {
    service.delete(id, version); return ApiResponse.ok(null);
  }
}
