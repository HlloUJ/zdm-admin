package com.zdm.platform.media;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/media")
public class MediaAdminController {
  private final MediaCleanupScheduler cleanupScheduler;
  private final MediaAuditService auditService;
  private final PermissionGuard permissionGuard;

  public MediaAdminController(
      MediaCleanupScheduler cleanupScheduler,
      MediaAuditService auditService,
      PermissionGuard permissionGuard) {
    this.cleanupScheduler = cleanupScheduler;
    this.auditService = auditService;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping("/audit")
  public ApiResponse<MediaAuditSummary> audit() {
    permissionGuard.requireSuperAdmin();
    return ApiResponse.ok(auditService.audit());
  }

  @PostMapping("/cleanup")
  public ApiResponse<MediaCleanupSummary> cleanup() {
    permissionGuard.requireSuperAdmin();
    return ApiResponse.ok(cleanupScheduler.runCleanup("manual"));
  }
}
