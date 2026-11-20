package com.zdm.platform.media;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** History references never change business ownership and do not duplicate originals. */
@Service
public class MediaHistoryService {
  @org.springframework.beans.factory.annotation.Autowired
  private StoreMediaBusinessFence storeFence;
  @org.springframework.beans.factory.annotation.Autowired
  private MediaPreviewReferenceService previewReferences;
  private final JdbcTemplate jdbc;
  private final MediaAssetMapper assets;
  private final MediaStorageService storage;
  private final MediaRetentionService retention;

  public MediaHistoryService(JdbcTemplate jdbc, MediaAssetMapper assets, MediaStorageService storage, MediaRetentionService retention) {
    this.jdbc = jdbc;
    this.assets = assets;
    this.storage = storage;
    this.retention = retention;
  }

  @Transactional
  public void retain(String domain, Long logId, Map<String, Long> media) {
    storeFence.requireParent(domain, logId);
    media.entrySet().stream().filter(entry -> entry.getValue() != null)
        .sorted(Map.Entry.comparingByValue()).forEach(entry -> {
          MediaAsset asset = assets.selectByIdForUpdate(entry.getValue());
          if (asset == null) {
            return;
          }
          reference(asset, domain, logId, entry.getKey(), "HISTORY");
          if (asset.getHistoryPreviewMediaId() != null) {
            MediaAsset preview = assets.selectByIdForUpdate(asset.getHistoryPreviewMediaId());
            if (preview != null && !"deleted".equals(preview.getStatus())) {
              reference(preview, domain, logId, entry.getKey() + ":preview", "PREVIEW");
              jdbc.update("UPDATE media_assets SET unreferenced_since=NULL WHERE id=?", preview.getId());
            }
          }
          retention.released(asset.getId());
        });
  }

  private void reference(MediaAsset asset, String domain, Long id, String field, String kind) {
    jdbc.update("""
        INSERT INTO media_references
          (media_id,business_domain,business_id,field_key,owner_client_code,tenant_id,store_id,reference_kind)
        VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE media_id=VALUES(media_id)
        """, asset.getId(), domain, id, field, asset.getOwnerClientCode(), asset.getTenantId(), asset.getStoreId(), kind);
  }

  public List<Long> deletedLogIds() {
    return jdbc.queryForList("""
        SELECT DISTINCT r.business_id FROM media_references r LEFT JOIN slab_operation_logs l ON l.id=r.business_id
        WHERE r.business_domain='SLAB_LOG' AND l.id IS NULL
        """, Long.class);
  }

  public List<Long> pendingPreviews() {
    return jdbc.queryForList("""
        SELECT a.id FROM media_assets a WHERE (a.status <> 'deleted' OR (a.history_preview_state='ready'
          AND EXISTS (SELECT 1 FROM media_assets p WHERE p.id=a.history_preview_media_id AND p.status<>'deleted')))
          AND EXISTS (SELECT 1 FROM media_references r WHERE r.media_id=a.id AND r.reference_kind='HISTORY'
            AND __SCOPE__ AND (a.history_preview_state IS NULL OR a.history_preview_state <> 'ready'
              OR (EXISTS (SELECT 1 FROM media_assets p WHERE p.id=a.history_preview_media_id AND p.status<>'deleted')
                AND NOT EXISTS (SELECT 1 FROM media_references p WHERE p.media_id=a.history_preview_media_id
                  AND p.business_domain=r.business_domain AND p.business_id=r.business_id
                  AND p.field_key=CONCAT(r.field_key,':preview') AND p.reference_kind='PREVIEW'))))
        ORDER BY a.updated_at, a.id LIMIT 100
        """.replace("__SCOPE__", previewReferences.eligibleHistorySql()), Long.class);
  }

  @Transactional
  public void generatePreview(Long mediaId) {
    // Never take the media lock before the store root and its business parents.
    List<Long> references = previewReferences.lockHistoryReferences(mediaId);
    if (references.isEmpty()) { return; }
    MediaAsset source = assets.selectByIdForUpdate(mediaId);
    if (source == null) { return; }
    boolean reuse = "ready".equals(source.getHistoryPreviewState());
    if ("deleted".equals(source.getStatus()) && !reuse) { return; }
    try {
      MediaAsset preview;
      if (reuse) {
        preview = assets.selectByIdForUpdate(source.getHistoryPreviewMediaId());
        if (preview == null || "deleted".equals(preview.getStatus())) { return; }
      } else {
        MediaAsset input = source;
        if ("video".equals(source.getMediaType())) {
          List<Long> covers = jdbc.queryForList("SELECT id FROM media_assets WHERE derived_from_media_id=? AND media_type='image' AND status<>'deleted' ORDER BY id LIMIT 1", Long.class, mediaId);
          if (covers.isEmpty()) {
            throw new IllegalArgumentException("视频缺少可用封面，原文件继续保护");
          }
          input = assets.selectByIdForUpdate(covers.getFirst());
        }
        MediaStorageService.StoredMedia stored = storage.createHistoryPreview(input.getStorageKey());
        if (org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
          org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
              new org.springframework.transaction.support.TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                  if (status == STATUS_ROLLED_BACK) { storage.delete(stored.storageKey()); }
                }
              });
        }
        preview = new MediaAsset();
        preview.setPublicId(stored.publicId());
        preview.setStorageKey(stored.storageKey());
        preview.setMediaType("image");
        preview.setMimeType(stored.mimeType());
        preview.setFileSize(stored.fileSize());
        preview.setOriginalName(source.getOriginalName() + "-历史预览.jpg");
        preview.setAccessLevel(source.getAccessLevel());
        preview.setOwnerClientCode(source.getOwnerClientCode());
        preview.setTenantId(source.getTenantId());
        preview.setStoreId(source.getStoreId());
        preview.setCreatedByAccountId(source.getCreatedByAccountId());
        preview.setStatus("active");
        preview.setUnreferencedSince(LocalDateTime.now());
        try { assets.insert(preview); }
        catch (RuntimeException exception) { storage.delete(stored.storageKey()); throw exception; }
      }
      List<Object> arguments = new java.util.ArrayList<>(); arguments.add(preview.getId()); arguments.add(mediaId); arguments.addAll(references);
      jdbc.update("""
          INSERT INTO media_references
            (media_id,business_domain,business_id,field_key,owner_client_code,tenant_id,store_id,reference_kind)
          SELECT ?,business_domain,business_id,CONCAT(field_key,':preview'),owner_client_code,tenant_id,store_id,'PREVIEW'
          FROM media_references WHERE media_id=? AND reference_kind='HISTORY' AND id IN (
          """ + String.join(",", java.util.Collections.nCopies(references.size(), "?"))
          + ") ON DUPLICATE KEY UPDATE media_id=VALUES(media_id)", arguments.toArray());
      if (retention.count(preview.getId(), "PREVIEW") > 0) {
        jdbc.update("UPDATE media_assets SET unreferenced_since=NULL WHERE id=?", preview.getId());
      } else { retention.released(preview.getId()); }
      source.setHistoryPreviewMediaId(preview.getId());
      source.setHistoryPreviewState("ready");
      source.setHistoryPreviewError(null);
    } catch (RuntimeException exception) {
      if (!reuse) { source.setHistoryPreviewState("failed"); }
      String message = exception.getMessage() == null ? "历史预览生成失败" : exception.getMessage();
      source.setHistoryPreviewError(message.substring(0, Math.min(500, message.length())));
    }
    source.setUpdatedAt(LocalDateTime.now());
    assets.updateById(source);
  }

  @Transactional
  public void release(String domain, Long logId) {
    List<Long> ids = jdbc.queryForList("SELECT media_id FROM media_references WHERE business_domain=? AND business_id=? AND reference_kind IN ('HISTORY','PREVIEW')", Long.class, domain, logId);
    ids.stream().distinct().sorted().forEach(assets::selectByIdForUpdate);
    jdbc.update("DELETE FROM media_references WHERE business_domain=? AND business_id=? AND reference_kind IN ('HISTORY','PREVIEW')", domain, logId);
    ids.forEach(retention::released);
  }

  public Map<String, Object> view(Long mediaId, String expectedType) {
    Map<String, Object> result = new LinkedHashMap<>();
    MediaAsset original = assets.selectById(mediaId);
    result.put("mediaType", expectedType);
    result.put("available", false);
    if (original == null) { result.put("message", "历史媒体已不可用"); return result; }
    boolean deleted = "deleted".equals(original.getStatus());
    if (!deleted && storage.load(original.getStorageKey()).exists()) {
      result.put("available", true);
      result.put("url", "/api/open/media/" + original.getPublicId());
      result.put("mimeType", original.getMimeType());
    } else if (deleted && original.getHistoryPreviewMediaId() != null) {
      MediaAsset preview = assets.selectById(original.getHistoryPreviewMediaId());
      if (preview != null && !"deleted".equals(preview.getStatus()) && storage.load(preview.getStorageKey()).exists()) {
        result.put("available", true);
        result.put("url", "/api/open/media/" + preview.getPublicId());
        result.put("mediaType", "image");
        result.put("mimeType", preview.getMimeType());
        result.put("previewOnly", true);
        result.put("message", "video".equals(original.getMediaType()) ? "历史视频已过保留期" : "原图已过保留期，当前展示历史预览图");
      }
    }
    if (!Boolean.TRUE.equals(result.get("available"))) {
      result.put("message", deleted ? "历史媒体已不可用" : "媒体暂不可用");
    }
    result.put("originalName", original.getOriginalName());
    return result;
  }
}
