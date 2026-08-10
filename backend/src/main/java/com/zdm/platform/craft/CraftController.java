package com.zdm.platform.craft;

import com.zdm.platform.common.AdminCrudController;
import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/admin/crafts")
public class CraftController extends AdminCrudController<Craft> {
  private final CraftService service;
  private final CraftImageStorageService imageStorageService;
  private final CraftPermissionGuard permissionGuard;

  public CraftController(
      CraftService service,
      CraftImageStorageService imageStorageService,
      CraftPermissionGuard permissionGuard,
      PermissionGuard securityPermissionGuard) {
    super(service, securityPermissionGuard, CraftPermissionGuard.PREFIX);
    this.service = service;
    this.imageStorageService = imageStorageService;
    this.permissionGuard = permissionGuard;
  }

  @Override
  @GetMapping
  public ApiResponse<List<Craft>> list() {
    permissionGuard.requireView();
    return ApiResponse.ok(service.list());
  }

  @Override
  @PostMapping
  public ApiResponse<Craft> create(@Valid @RequestBody Craft craft) {
    permissionGuard.requireCreate();
    return ApiResponse.ok(service.createCraft(craft));
  }

  @Override
  @PutMapping("/{id}")
  public ApiResponse<Craft> update(@PathVariable Long id, @Valid @RequestBody Craft craft) {
    permissionGuard.requireEdit();
    Craft updated = service.updateCraft(id, craft);
    if (updated == null) {
      throw new IllegalArgumentException("工艺不存在");
    }
    return ApiResponse.ok(updated);
  }

  @PostMapping("/images")
  public ApiResponse<CraftImageUploadResponse> uploadImage(@RequestParam("file") MultipartFile file) {
    permissionGuard.requireImageUpload();
    return ApiResponse.ok(new CraftImageUploadResponse(imageStorageService.store(file)));
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<Craft> updateStatus(
      @PathVariable Long id,
      @Valid @RequestBody CraftStatusRequest request) {
    permissionGuard.requireToggleStatus();
    Craft craft = service.getById(id);
    if (craft == null) {
      throw new IllegalArgumentException("工艺不存在");
    }

    craft.setStatus(request.status());
    service.updateById(craft);
    return ApiResponse.ok(service.getById(id));
  }

  @Override
  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requireDelete();
    return ApiResponse.ok(service.removeById(id));
  }

  @ExceptionHandler(DuplicateKeyException.class)
  public ResponseEntity<ApiResponse<Void>> handleDuplicateName(DuplicateKeyException exception) {
    return ResponseEntity.badRequest().body(ApiResponse.fail("工艺名称已存在"));
  }

  @ExceptionHandler(AccessDeniedException.class)
  public ResponseEntity<ApiResponse<Void>> handleAccessDenied(AccessDeniedException exception) {
    return ResponseEntity.status(HttpStatus.FORBIDDEN)
        .body(new ApiResponse<>(HttpStatus.FORBIDDEN.value(), exception.getMessage(), null));
  }
}
