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
  private final MediaLifecycleMigrationService migration;
  private final MediaRetentionService retention;
  private final MediaAssetMapper assets;
  private final org.springframework.jdbc.core.JdbcTemplate jdbc;
  private final com.zdm.platform.security.CurrentIdentityProvider identityProvider;

  public MediaAdminController(
      MediaCleanupScheduler cleanupScheduler,
      MediaAuditService auditService,
      PermissionGuard permissionGuard, MediaLifecycleMigrationService migration, MediaRetentionService retention,
      MediaAssetMapper assets, org.springframework.jdbc.core.JdbcTemplate jdbc, com.zdm.platform.security.CurrentIdentityProvider identityProvider) {
    this.identityProvider = identityProvider;
    this.migration = migration; this.retention = retention; this.assets = assets; this.jdbc = jdbc;
    this.cleanupScheduler = cleanupScheduler;
    this.auditService = auditService;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping("/lifecycle")
  public ApiResponse<java.util.Map<String, Object>> lifecycle() {
    permissionGuard.requireSuperAdmin();
    var candidates = assets.selectList(null).stream().filter(asset -> !"deleted".equals(asset.getStatus()))
        .map(asset -> java.util.Map.of("id", asset.getId(), "decision", retention.evaluate(asset))).toList();
    return ApiResponse.ok(java.util.Map.of("deletionEnabled", retention.deletionEnabled(), "files", retention.inventory(), "decisions", candidates));
  }

  @PostMapping("/lifecycle/migrate")
  public ApiResponse<java.util.Map<String, Object>> migrate() {
    permissionGuard.requireSuperAdmin();
    return ApiResponse.ok(migration.migrate());
  }

  @PostMapping("/lifecycle/deletion")
  @org.springframework.transaction.annotation.Transactional
  public ApiResponse<Boolean> setDeletion(@org.springframework.web.bind.annotation.RequestBody DeletionRequest request) {
    permissionGuard.requireSuperAdmin();
    if (request.enabled() && !Boolean.TRUE.equals(jdbc.queryForObject("SELECT migration_completed FROM media_lifecycle_control WHERE id=1", Boolean.class))) {
      throw new IllegalArgumentException("请先完成媒体引用迁移和清理清单核对");
    }
    if (request.reason() == null || request.reason().isBlank()) {
      throw new IllegalArgumentException("请输入清理模式调整原因");
    }
    jdbc.update("UPDATE media_lifecycle_control SET deletion_enabled=?,updated_at=NOW() WHERE id=1", request.enabled());
    auditEvent(null, request.enabled() ? "ENABLE_DELETION" : "PAUSE_DELETION", request.reason());
    return ApiResponse.ok(request.enabled());
  }

  @PostMapping("/lifecycle/hold")
  @org.springframework.transaction.annotation.Transactional
  public ApiResponse<Boolean> hold(@org.springframework.web.bind.annotation.RequestBody HoldRequest request) {
    permissionGuard.requireSuperAdmin();
    if (request.reason() == null || request.reason().isBlank()) {
      throw new IllegalArgumentException("请输入保留或解除原因");
    }
    MediaAsset asset = assets.selectByIdForUpdate(request.mediaId());
    if (asset == null || "deleted".equals(asset.getStatus())) {
      throw new IllegalArgumentException("媒体已不可用");
    }
    if (request.enabled()) {
      jdbc.update("""
          INSERT INTO media_references(media_id,business_domain,business_id,field_key,owner_client_code,reference_kind,retention_reason)
          VALUES (?,'MANUAL_HOLD',?,'hold',?,'MANUAL',?) ON DUPLICATE KEY UPDATE retention_reason=VALUES(retention_reason)
          """, asset.getId(), asset.getId(), asset.getOwnerClientCode(), request.reason());
    } else {
      jdbc.update("DELETE FROM media_references WHERE business_domain='MANUAL_HOLD' AND business_id=?", asset.getId());
      retention.released(asset.getId());
    }
    auditEvent(asset.getId(), request.enabled() ? "MANUAL_HOLD" : "RELEASE_HOLD", request.reason());
    return ApiResponse.ok(true);
  }

  private void auditEvent(Long mediaId, String type, String reason) {
    jdbc.update("INSERT INTO media_lifecycle_events(media_id,event_type,reason,operator_name) VALUES (?,?,?,?)",
        mediaId, type, reason, identityProvider.require().displayName());
  }

  public record DeletionRequest(boolean enabled, String reason) {}
  public record HoldRequest(Long mediaId, boolean enabled, String reason) {}

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
