package com.zdm.platform.customer;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.media.MediaStorageService;
import com.zdm.platform.media.MediaUploadResponse;
import jakarta.validation.Valid;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/admin/store-customers")
public class CustomerController {
  private final CustomerService service;
  private final MediaAssetService media;
  private final MediaStorageService storage;
  public CustomerController(CustomerService service, MediaAssetService media, MediaStorageService storage) {
    this.service=service; this.media=media; this.storage=storage;
  }
  @GetMapping
  public ApiResponse<List<CustomerService.Customer>> list(@RequestParam String status,
      @RequestParam(defaultValue="") String name,@RequestParam(defaultValue="") String phone,
      @RequestParam(required=false) Long ownerAccountId) {
    return ApiResponse.ok(service.list(status,name,phone,ownerAccountId));
  }
  @GetMapping("/owners")
  public ApiResponse<List<CustomerService.Owner>> owners(@RequestParam String status) {
    return ApiResponse.ok(service.owners(status));
  }
  @GetMapping("/contact-regions")
  public ApiResponse<CustomerContactRegions.Catalogue> contactRegions(@RequestParam String status) {
    return ApiResponse.ok(service.contactCatalogue(status));
  }
  @GetMapping("/owner-candidates")
  public ApiResponse<List<CustomerService.Owner>> ownerCandidates(@RequestParam(required=false) Long customerId) {
    return ApiResponse.ok(service.ownerCandidates(customerId));
  }
  @GetMapping("/{id}")
  public ApiResponse<CustomerService.Detail> detail(@PathVariable Long id) { return ApiResponse.ok(service.detail(id)); }
  @PostMapping
  public ApiResponse<CustomerService.Customer> create(@Valid @RequestBody CustomerRequests.Profile request) {
    return ApiResponse.ok(service.create(request));
  }
  @PutMapping("/{id}")
  public ApiResponse<CustomerService.Customer> update(@PathVariable Long id,@Valid @RequestBody CustomerRequests.Profile request) {
    return ApiResponse.ok(service.update(id,request));
  }
  @PostMapping("/action")
  public ApiResponse<Boolean> action(@Valid @RequestBody CustomerRequests.Action request) {
    service.action(request,false); return ApiResponse.ok(true);
  }
  @PostMapping("/batch")
  public ApiResponse<Boolean> batch(@Valid @RequestBody CustomerRequests.Action request) {
    service.action(request,true); return ApiResponse.ok(true);
  }
  @PostMapping("/{id}/followups")
  public ApiResponse<Boolean> createFollowup(@PathVariable Long id,@Valid @RequestBody CustomerRequests.Followup request) {
    service.saveFollowup(id,null,request); return ApiResponse.ok(true);
  }
  @PutMapping("/{id}/followups/{followupId}")
  public ApiResponse<Boolean> editFollowup(@PathVariable Long id,@PathVariable Long followupId,@Valid @RequestBody CustomerRequests.Followup request) {
    service.saveFollowup(id,followupId,request); return ApiResponse.ok(true);
  }
  @DeleteMapping("/{id}/followups/{followupId}")
  public ApiResponse<Boolean> deleteFollowup(@PathVariable Long id,@PathVariable Long followupId) {
    service.deleteFollowup(id,followupId); return ApiResponse.ok(true);
  }
  @PostMapping("/{id}/attachments")
  public ApiResponse<MediaUploadResponse> upload(@PathVariable Long id,@RequestParam("file") MultipartFile file) {
    service.requireUpload(id); return ApiResponse.ok(media.uploadAttachment(file,CustomerService.FILE_LIMIT));
  }
  @DeleteMapping("/{id}/attachments/{mediaId}")
  public ApiResponse<Boolean> release(@PathVariable Long id,@PathVariable Long mediaId) {
    service.releaseUpload(id,mediaId); return ApiResponse.ok(true);
  }
  @GetMapping("/{id}/followups/{followupId}/attachments/{mediaId}")
  public ResponseEntity<Resource> attachment(@PathVariable Long id,@PathVariable Long followupId,@PathVariable Long mediaId) {
    var asset=service.readAttachment(id,followupId,mediaId);
    boolean image=List.of("image/jpeg","image/png","image/gif","image/webp").contains(asset.getMimeType());
    var disposition=(image ? ContentDisposition.inline() : ContentDisposition.attachment())
        .filename(asset.getOriginalName(),StandardCharsets.UTF_8).build();
    return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION,disposition.toString())
        .header("X-Content-Type-Options","nosniff").header(HttpHeaders.CACHE_CONTROL,"no-store")
        .contentType(image ? MediaType.parseMediaType(asset.getMimeType()) : MediaType.APPLICATION_OCTET_STREAM)
        .body(storage.load(asset.getStorageKey()));
  }
}
