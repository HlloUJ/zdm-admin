package com.zdm.platform.catalog;

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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/template-versions")
public class TemplateVersionController {
  private final TemplateVersionService service;
  public TemplateVersionController(TemplateVersionService service) { this.service = service; }

  @GetMapping("/categories")
  public ApiResponse<List<ProductCategory>> categories(@RequestParam String scope) {
    return ApiResponse.ok(service.categoryOptions(scope));
  }
  @GetMapping("/attribute-options")
  public ApiResponse<List<ProductAttribute>> attributes(@RequestParam long categoryId) {
    return ApiResponse.ok(service.attributeOptions(categoryId));
  }
  @GetMapping("/value-options")
  public ApiResponse<List<ProductAttributeValue>> values(@RequestParam long categoryId, @RequestParam long attributeId) {
    return ApiResponse.ok(service.valueOptions(categoryId, attributeId));
  }
  @GetMapping
  public ApiResponse<List<TemplateVersion>> list(@RequestParam long categoryId) {
    return ApiResponse.ok(service.list(categoryId));
  }
  @GetMapping("/{id}")
  public ApiResponse<TemplateVersion> get(@PathVariable long id) { return ApiResponse.ok(service.get(id)); }
  public static class CreateRequest {
    private long categoryId;

    public void setCategoryId(long categoryId) { this.categoryId = categoryId; }
    private boolean unsupportedFields;

    @com.fasterxml.jackson.annotation.JsonAnySetter
    public void captureUnknownField(String name, Object value) {
      unsupportedFields = true;
    }
  }
  public record RevisionRequest(int revision) {}
  @PostMapping
  public ApiResponse<TemplateVersion> create(@RequestBody CreateRequest request) {
    if (request.unsupportedFields) {
      throw new IllegalArgumentException("创建属性模板只接受分类参数");
    }
    return ApiResponse.ok(service.create(request.categoryId));
  }
  public record CopyRequest(Long draftId, Integer revision) {}
  @PostMapping("/{id}/copy")
  public ApiResponse<TemplateVersion> copy(@PathVariable long id, @RequestBody CopyRequest request) {
    return ApiResponse.ok(service.copy(id, request.draftId(), request.revision()));
  }
  @PutMapping("/{id}")
  public ApiResponse<TemplateVersion> save(@PathVariable long id, @Valid @RequestBody TemplateVersionRequest request) {
    return ApiResponse.ok(service.save(id, request));
  }
  @PostMapping("/{id}/publish")
  public ApiResponse<TemplateVersion> publish(@PathVariable long id, @RequestBody RevisionRequest request) {
    return ApiResponse.ok(service.publish(id, request.revision()));
  }
  public record DisplayOrderRequest(int revision, List<Long> attributeIds) {
    public DisplayOrderRequest {
      attributeIds = attributeIds == null ? null : List.copyOf(attributeIds);
    }
  }
  @PutMapping("/{id}/display-order")
  public ApiResponse<TemplateVersion> reorder(@PathVariable long id, @RequestBody DisplayOrderRequest request) {
    return ApiResponse.ok(service.reorder(id, request.revision(), request.attributeIds()));
  }
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> discard(@PathVariable long id, @RequestParam int revision) {
    service.discard(id, revision);
    return ApiResponse.ok(true);
  }
}
