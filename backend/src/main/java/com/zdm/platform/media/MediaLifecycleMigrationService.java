package com.zdm.platform.media;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jsoup.Jsoup;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MediaLifecycleMigrationService {
  private static final Map<String, String> SLAB_FIELDS = Map.of(
      "main_image_media_id", "mainImage", "scan_image_media_id", "scanImage", "design_image_media_id", "designImage",
      "video_media_id", "video", "video_cover_media_id", "videoCover");
  private static final List<String> LOG_FIELDS = List.of("1:1主图", "扫描图", "设计图", "商品视频", "视频封面");
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final MediaHistoryService history;
  private final MediaAssetMapper assets;
  private final MediaRetentionService retention;

  public MediaLifecycleMigrationService(JdbcTemplate jdbc, ObjectMapper json, MediaHistoryService history, MediaAssetMapper assets, MediaRetentionService retention) {
    this.jdbc = jdbc; this.json = json; this.history = history; this.assets = assets; this.retention = retention;
  }

  @Transactional
  public Map<String, Object> migrate() {
    jdbc.queryForObject("SELECT id FROM media_lifecycle_control WHERE id=1 FOR UPDATE", Integer.class);
    if (retention.deletionEnabled()) {
      throw new IllegalArgumentException("请先暂停物理删除再执行迁移核对");
    }
    List<String> anomalies = new ArrayList<>();
    for (Map<String, Object> row : jdbc.queryForList("SELECT * FROM slab_inventory FOR UPDATE")) {
      SLAB_FIELDS.forEach((column, field) -> repair("SLAB", number(row.get("id")), field, number(row.get(column)), anomalies));
    }
    for (Map<String, Object> row : jdbc.queryForList("SELECT id,image_media_id FROM crafts FOR UPDATE")) {
      repair("FINISHED_STOCK_CRAFT", number(row.get("id")), "image", number(row.get("image_media_id")), anomalies);
    }
    for (Map<String, Object> row : jdbc.queryForList("SELECT id,main_image_media_id,video_media_id,detail FROM finished_products FOR UPDATE")) {
      Long id = number(row.get("id"));
      repair("FINISHED_PRODUCT", id, "mainImage", number(row.get("main_image_media_id")), anomalies);
      repair("FINISHED_PRODUCT", id, "video", number(row.get("video_media_id")), anomalies);
      for (var element : Jsoup.parseBodyFragment(row.get("detail") == null ? "" : row.get("detail").toString()).select("img,video")) {
        String source = element.attr("src");
        if (source.matches("media:[0-9]+")) {
          Long mediaId = Long.valueOf(source.substring(6));
          repair("FINISHED_PRODUCT", id, "detailMedia" + mediaId, mediaId, anomalies);
        }
      }
    }
    for (Map<String, Object> row : jdbc.queryForList("SELECT id,change_details FROM slab_operation_logs WHERE change_details IS NOT NULL")) {
      try {
        var details = json.readTree(row.get("change_details").toString());
        Map<String, Long> ids = new LinkedHashMap<>();
        for (String field : LOG_FIELDS) {
          for (String side : List.of("before", "after")) {
            var value = details.path(field).path(side);
            if (value.isIntegralNumber() || value.isTextual() && value.asText().matches("[0-9]+")) {
              ids.put(field + ":" + side, value.asLong());
            }
          }
        }
        history.retain("SLAB_LOG", number(row.get("id")), ids);
      } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
        anomalies.add("日志 " + row.get("id") + " 的历史详情无法解析");
      }
    }
    jdbc.update("""
        UPDATE media_assets a SET unreferenced_since=COALESCE(unreferenced_since,NOW())
        WHERE status<>'deleted' AND NOT EXISTS (SELECT 1 FROM media_references r
          WHERE r.media_id=a.id AND r.reference_kind IN ('BUSINESS','PREVIEW'))
        """);
    jdbc.update("UPDATE media_lifecycle_control SET migration_completed=?,updated_at=NOW() WHERE id=1", anomalies.isEmpty());
    return Map.of("deletionEnabled", false, "anomalies", anomalies, "pendingPreviews", history.pendingPreviews().size());
  }

  private void repair(String domain, Long businessId, String field, Long mediaId, List<String> anomalies) {
    if (mediaId == null) {
      return;
    }
    MediaAsset asset = assets.selectByIdForUpdate(mediaId);
    if (asset == null || "deleted".equals(asset.getStatus())) {
      anomalies.add(domain + "/" + businessId + "/" + field + " 媒体不可用：" + mediaId); return;
    }
    jdbc.update("""
        INSERT INTO media_references (media_id,business_domain,business_id,field_key,owner_client_code,tenant_id,store_id,reference_kind)
        VALUES (?,?,?,?,?,?,?,'BUSINESS') ON DUPLICATE KEY UPDATE media_id=VALUES(media_id)
        """, mediaId, domain, businessId, field, asset.getOwnerClientCode(), asset.getTenantId(), asset.getStoreId());
    jdbc.update("UPDATE media_assets SET unreferenced_since=NULL,status='active' WHERE id=?", mediaId);
  }

  private Long number(Object value) { return value instanceof Number number ? number.longValue() : null; }
}
