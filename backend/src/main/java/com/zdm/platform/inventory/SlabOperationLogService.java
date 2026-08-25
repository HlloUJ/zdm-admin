package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.media.MediaAsset;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.media.MediaUploadResponse;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.BeanPropertyRowMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class SlabOperationLogService extends ServiceImpl<SlabOperationLogMapper, SlabOperationLog> {
  private static final String EXTERNAL_API_SOURCE = "EXTERNAL_API";
  private static final Map<String, String> REFERENCE_TABLES = Map.of(
      "供应商ID", "suppliers",
      "品种ID", "slab_varieties",
      "产地ID", "slab_origins",
      "纹理ID", "slab_textures",
      "色系ID", "slab_colors",
      "等级ID", "slab_grades");
  private static final Map<String, String> MEDIA_TYPES = Map.of(
      "1:1主图", "image",
      "扫描图", "image",
      "设计图", "image",
      "商品视频", "video",
      "视频封面", "image");

  private final CurrentIdentityProvider identityProvider;
  private final ObjectMapper objectMapper;
  private final JdbcTemplate jdbcTemplate;
  private final MediaAssetService mediaAssetService;

  public SlabOperationLogService(
      CurrentIdentityProvider identityProvider,
      ObjectMapper objectMapper,
      JdbcTemplate jdbcTemplate,
      MediaAssetService mediaAssetService) {
    this.identityProvider = identityProvider;
    this.objectMapper = objectMapper;
    this.jdbcTemplate = jdbcTemplate;
    this.mediaAssetService = mediaAssetService;
  }

  public SlabOperationLogPage listPage(
      String keyword,
      String operationType,
      String operatorName,
      LocalDate startDate,
      LocalDate endDate,
      int requestedPage,
      int requestedPageSize) {
    int page = Math.max(requestedPage, 1);
    int pageSize = Math.min(Math.max(requestedPageSize, 1), 100);
    List<Object> parameters = new ArrayList<>();
    String where = buildWhereClause(
        keyword, operationType, operatorName, startDate, endDate, parameters);
    Long total = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM slab_operation_logs" + where,
        Long.class,
        parameters.toArray());
    List<Object> pageParameters = new ArrayList<>(parameters);
    pageParameters.add(pageSize);
    pageParameters.add((page - 1) * pageSize);
    List<SlabOperationLog> records = jdbcTemplate.query(
        "SELECT * FROM slab_operation_logs" + where
            + " ORDER BY operated_at DESC, id DESC LIMIT ? OFFSET ?",
        BeanPropertyRowMapper.newInstance(SlabOperationLog.class),
        pageParameters.toArray());
    Map<String, Map<Long, String>> referenceCaches = new HashMap<>();
    Map<Long, MediaAsset> mediaCache = new HashMap<>();
    records.forEach(record -> record.setChangeDetails(
        resolveChangeDetails(record.getChangeDetails(), referenceCaches, mediaCache)));
    return new SlabOperationLogPage(records, total == null ? 0 : total, page, pageSize);
  }

  private String resolveChangeDetails(
      String changeDetails,
      Map<String, Map<Long, String>> referenceCaches,
      Map<Long, MediaAsset> mediaCache) {
    if (changeDetails == null || changeDetails.isBlank()) {
      return changeDetails;
    }
    try {
      Map<String, Map<String, Object>> changes = objectMapper.readValue(
          changeDetails,
          new TypeReference<LinkedHashMap<String, Map<String, Object>>>() {});
      changes.forEach((field, change) -> {
        if (REFERENCE_TABLES.containsKey(field)) {
          change.computeIfPresent("before", (key, value) -> resolveReferenceName(field, value, referenceCaches));
          change.computeIfPresent("after", (key, value) -> resolveReferenceName(field, value, referenceCaches));
        } else if (MEDIA_TYPES.containsKey(field)) {
          change.remove("before");
          change.computeIfPresent("after", (key, value) -> resolveMedia(field, value, mediaCache));
        }
      });
      return objectMapper.writeValueAsString(changes);
    } catch (JsonProcessingException | RuntimeException exception) {
      return changeDetails;
    }
  }

  private Object resolveReferenceName(
      String field,
      Object value,
      Map<String, Map<Long, String>> referenceCaches) {
    Long id = parseId(value);
    if (id == null) {
      return value;
    }
    String table = REFERENCE_TABLES.get(field);
    Map<Long, String> names = referenceCaches.computeIfAbsent(table, this::loadReferenceNames);
    return names.getOrDefault(id, "已删除或不可用");
  }

  private Map<Long, String> loadReferenceNames(String table) {
    Map<Long, String> names = new HashMap<>();
    String displayColumn = "slab_grades".equals(table)
        ? "CONCAT(code, '（', name, '）')"
        : "name";
    jdbcTemplate.query("SELECT id, " + displayColumn + " AS display_name FROM " + table, resultSet -> {
      names.put(resultSet.getLong("id"), resultSet.getString("display_name"));
    });
    return names;
  }

  private Object resolveMedia(String field, Object value, Map<Long, MediaAsset> mediaCache) {
    Long id = parseId(value);
    if (id == null) {
      return value;
    }
    MediaAsset asset = mediaCache.computeIfAbsent(id, mediaAssetService::getById);
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("mediaType", MEDIA_TYPES.get(field));
    if (asset == null || "deleted".equals(asset.getStatus())) {
      result.put("available", false);
      return result;
    }
    MediaUploadResponse response = mediaAssetService.toResponse(asset);
    result.put("available", true);
    result.put("url", response.url());
    result.put("mediaType", response.mediaType());
    result.put("mimeType", response.mimeType());
    result.put("originalName", asset.getOriginalName());
    return result;
  }

  private Long parseId(Object value) {
    if (value instanceof Number number) {
      return number.longValue();
    }
    if (value instanceof String text) {
      try {
        return Long.valueOf(text);
      } catch (NumberFormatException exception) {
        return null;
      }
    }
    return null;
  }

  public void record(
      SlabInventory slab,
      String operationType,
      String operationSummary,
      String beforeStatus,
      String afterStatus,
      String standardReason,
      String detailReason,
      String operationSource,
      String batchNo,
      Map<String, ?> changes) {
    boolean externalOperation = EXTERNAL_API_SOURCE.equals(operationSource);
    CurrentIdentity identity = externalOperation ? null : identityProvider.require();
    LocalDateTime now = LocalDateTime.now();
    SlabOperationLog log = new SlabOperationLog();
    log.setSlabId(slab.getId());
    log.setSlabSerialNo(slab.getSerialNo());
    log.setSlabName(slab.getName());
    log.setPublisherType(slab.getPublisherType());
    log.setOperationType(operationType);
    log.setOperationSummary(operationSummary);
    log.setBeforeStatus(beforeStatus);
    log.setAfterStatus(afterStatus);
    log.setStandardReason(standardReason);
    log.setDetailReason(detailReason);
    log.setChangeDetails(serializeChanges(changes));
    log.setOperationSource(operationSource);
    log.setBatchNo(batchNo);
    log.setOperatorName(externalOperation ? "外部系统" : identity.displayName());
    log.setOperatorAccountId(externalOperation ? null : identity.accountId());
    log.setOperatedAt(now);
    log.setCreatedAt(now);
    save(log);
  }

  private String buildWhereClause(
      String keyword,
      String operationType,
      String operatorName,
      LocalDate startDate,
      LocalDate endDate,
      List<Object> parameters) {
    List<String> conditions = new ArrayList<>();
    if (keyword != null && !keyword.isBlank()) {
      String normalizedKeyword = "%" + keyword.trim() + "%";
      conditions.add("(slab_name LIKE ? OR slab_serial_no LIKE ? OR CAST(slab_id AS CHAR) LIKE ?)");
      parameters.add(normalizedKeyword);
      parameters.add(normalizedKeyword);
      parameters.add(normalizedKeyword);
    }
    if (operationType != null && !operationType.isBlank()) {
      conditions.add("operation_type = ?");
      parameters.add(operationType.trim());
    }
    if (operatorName != null && !operatorName.isBlank()) {
      conditions.add("operator_name LIKE ?");
      parameters.add("%" + operatorName.trim() + "%");
    }
    if (startDate != null) {
      conditions.add("operated_at >= ?");
      parameters.add(startDate.atStartOfDay());
    }
    if (endDate != null) {
      conditions.add("operated_at < ?");
      parameters.add(endDate.plusDays(1).atStartOfDay());
    }
    return conditions.isEmpty() ? "" : " WHERE " + String.join(" AND ", conditions);
  }

  private String serializeChanges(Map<String, ?> changes) {
    if (changes == null || changes.isEmpty()) {
      return null;
    }
    try {
      return objectMapper.writeValueAsString(changes);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("大板操作日志序列化失败", exception);
    }
  }
}
