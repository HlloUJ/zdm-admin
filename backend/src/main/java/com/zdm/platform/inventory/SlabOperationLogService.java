package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.media.MediaAsset;
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
  private static final String VISIBLE_TYPE = "CASE WHEN business_client_code='admin' AND operation_type='SOURCE_DELETE' THEN CASE "
      + "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(change_details, '$.\"来源状态\".after')), '')"
      + " WHEN 'recycle' THEN 'SOURCE_DELETE_TO_RECYCLE' ELSE 'SOURCE_PURGE' END "
      + "WHEN business_client_code='admin' AND operation_type='SOURCE_SYNC' THEN CASE "
      + "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(change_details, '$.\"来源状态\".after')), '')"
      + " WHEN 'selling' THEN 'SOURCE_SHELF' WHEN 'offShelf' THEN 'SOURCE_OFF_SHELF'"
      + " WHEN 'recycle' THEN 'SOURCE_DELETE_TO_RECYCLE' WHEN 'purged' THEN 'SOURCE_PURGE'"
      + " ELSE 'SOURCE_INTERNAL' END ELSE operation_type END";
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
  private final com.zdm.platform.media.MediaHistoryService historyService;

  public SlabOperationLogService(
      CurrentIdentityProvider identityProvider,
      ObjectMapper objectMapper,
      JdbcTemplate jdbcTemplate,
      com.zdm.platform.media.MediaHistoryService historyService) {
    this.historyService = historyService;
    this.identityProvider = identityProvider;
    this.objectMapper = objectMapper;
    this.jdbcTemplate = jdbcTemplate;
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
        "SELECT *, (" + VISIBLE_TYPE + ") AS visible_operation_type FROM slab_operation_logs" + where
            + " ORDER BY operated_at DESC, id DESC LIMIT ? OFFSET ?",
        (rs, rowNum) -> {
          SlabOperationLog record = BeanPropertyRowMapper.newInstance(SlabOperationLog.class).mapRow(rs, rowNum);
          if (record == null) { throw new IllegalStateException("大板操作日志映射失败"); }
          record.setOperationType(rs.getString("visible_operation_type"));
          if ("PURGE".equals(record.getOperationType()) && record.getAfterStatus() == null) {
            record.setAfterStatus("purged");
          }
          return record;
        },
        pageParameters.toArray());
    Map<String, Map<Long, String>> referenceCaches = new HashMap<>();
    Map<Long, MediaAsset> mediaCache = new HashMap<>();
    records.forEach(record -> {
      if (List.of("UPDATE", "PRICE_UPDATE").contains(record.getOperationType()) && record.getChangeDetails() != null) {
        try {
          Map<String, Object> changes = objectMapper.readValue(record.getChangeDetails(), new TypeReference<LinkedHashMap<String, Object>>() {});
          record.setChangeDetails(serializeChanges(SlabLogChanges.retainChanged(changes)));
        } catch (JsonProcessingException error) { throw new IllegalStateException("操作日志读取失败", error); }
      }
    });
    records.forEach(record -> {
      if (List.of("SOURCE_OFF_SHELF", "SOURCE_DELETE_TO_RECYCLE", "SOURCE_PURGE").contains(record.getOperationType())) {
        try {
          Map<String, Object> changes = objectMapper.readValue(record.getChangeDetails() == null ? "{}" : record.getChangeDetails(), new TypeReference<LinkedHashMap<String, Object>>() {});
          changes.keySet().retainAll(java.util.Set.of("来源状态"));
          record.setChangeDetails(serializeChanges(changes));
          record.setStandardReason(null);
          record.setDetailReason(null);
        } catch (JsonProcessingException error) { throw new IllegalStateException("操作日志读取失败", error); }
      }
    });
    records.forEach(this::restoreLegacyArrival);
    records.forEach(record -> {
      if (List.of("SOURCE_SHELF", "SOURCE_OFF_SHELF", "SOURCE_DELETE_TO_RECYCLE", "SOURCE_PURGE").contains(record.getOperationType())) {
        record.setOperationSummary(operationSummary(record.getOperationType(), record.getBeforeStatus(), Map.of()));
      }
    });
    records.forEach(record -> record.setChangeDetails(
        resolveChangeDetails(record.getChangeDetails(), referenceCaches, mediaCache)));
    return new SlabOperationLogPage(records, total == null ? 0 : total, page, pageSize);
  }

  public Map<String, Object> arrivalSnapshot(Long id) {
    Map<String, Object> row = jdbcTemplate.queryForMap("SELECT * FROM slab_inventory WHERE id=?", id);
    Map<String, Object> values = new LinkedHashMap<>();
    String[][] fields = {
      {"大板名称","name"},{"大板编号","serial_no"},{"供应商ID","supplier_id"},
      {"品种ID","variety_id"},{"产地ID","origin_id"},{"纹理ID","texture_id"},{"色系ID","color_id"},{"等级ID","grade_id"},
      {"长度","length_mm"},{"宽度","width_mm"},{"高度","thickness_mm"},{"面积","area_square_meter"},{"误差","tolerance_mm"},
      {"1:1主图","main_image_media_id"},{"扫描图","scan_image_media_id"},{"设计图","design_image_media_id"},
      {"商品视频","video_media_id"},{"视频封面","video_cover_media_id"},{"库存","stock"},{"仓库","warehouse"},
      {"成本价","cost_price"},{"指导价","guide_price"},{"指导价系数","guide_price_coefficient"},
      {"状态","status"},{"发布类型","publisher_type"},{"大板ID","id"},{"创建人","created_by_name"},{"创建时间","created_at"}
    };
    for (String[] field : fields) { values.put(field[0], row.get(field[1])); }
    for (int i=1;i<=4;i++) {
      values.put("扣角"+i+"长",row.get("corner"+i+"_length_mm"));
      values.put("扣角"+i+"宽",row.get("corner"+i+"_width_mm"));
    }
    List<Map<String,Object>> prices = jdbcTemplate.queryForList("SELECT * FROM slab_prices WHERE slab_id=? ORDER BY store_level_id",id);
    applyArrivalPrices(values, prices);
    return creationSnapshot(values);
  }

  private void applyArrivalPrices(Map<String,Object> values, List<Map<String,Object>> prices) {
    List<Map<String,Object>> tiers = new ArrayList<>();
    for (Map<String,Object> price : prices) {
      if (price.get("store_level_id") == null) {
        for (String[] field : new String[][]{{"成本价","cost_price"},{"指导价","guide_price"},{"指导价系数","guide_price_coefficient"}}) {
          if (price.containsKey(field[1])) { values.put(field[0],price.get(field[1])); }
        }
        continue;
      }
      Map<String,Object> tier = new LinkedHashMap<>();
      tier.put("storeLevelId",price.get("store_level_id"));
      tier.put("storeLevelName",price.get("store_level_name"));
      tier.put("priceCoefficient",price.get("price_coefficient"));
      tier.put("price",price.get("price"));
      tiers.add(tier);
      values.put(price.get("store_level_name")+"价格来源", "auto".equals(price.get("price_source")) ? "跟随配置" : "手工价格");
    }
    values.put("价格层级",tiers);
  }

  private void restoreLegacyArrival(SlabOperationLog log) {
    if (!"SOURCE_SHELF".equals(log.getOperationType()) || log.getChangeDetails() == null) { return; }
    try {
      Map<String, Map<String,Object>> changes = objectMapper.readValue(log.getChangeDetails(), new TypeReference<LinkedHashMap<String,Map<String,Object>>>() {});
      if (!changes.containsKey("入仓价格")) { return; }
      Map<String,Object> values = new LinkedHashMap<>();
      List<String> history = jdbcTemplate.queryForList("SELECT change_details FROM slab_operation_logs WHERE slab_id=? AND business_client_code='supply-chain' AND (operated_at<? OR (operated_at=? AND id<?)) ORDER BY operated_at,id",String.class,log.getSlabId(),log.getOperatedAt(),log.getOperatedAt(),log.getId());
      for (String snapshot : history) {
        if (snapshot == null) { continue; }
        Map<String,Map<String,Object>> details=objectMapper.readValue(snapshot,new TypeReference<LinkedHashMap<String,Map<String,Object>>>() {});
        details.forEach((field,change)-> {
          String key=REFERENCE_TABLES.containsKey(field)?field.replace("ID",""):field;
          Object value=change.get("after");
          if(REFERENCE_TABLES.containsKey(field)) { value=resolveReferenceName(field,value,new HashMap<>()); }
          values.put(key,value);
        });
      }
      var prices=objectMapper.convertValue(changes.get("入仓价格").get("after"),new TypeReference<List<Map<String,Object>>>() {});
      applyArrivalPrices(values,prices);
      values.put("大板名称",log.getSlabName());
      values.put("大板编号",log.getSlabSerialNo());
      values.put("状态","warehouse");
      values.remove("来源状态");
      log.setChangeDetails(serializeChanges(creationSnapshot(values)));
      log.setBeforeStatus(null);
      log.setAfterStatus("warehouse");
    } catch (JsonProcessingException error) { throw new IllegalStateException("大板入仓日志读取失败",error); }
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
          change.computeIfPresent("before", (key, value) -> resolveMedia(field, value, mediaCache));
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
    return historyService.view(id, MEDIA_TYPES.get(field));
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

  public Map<String, Object> creationSnapshot(Map<String, Object> values) {
    Map<String, Object> snapshot = new LinkedHashMap<>();
    Map<String, Map<Long, String>> referenceCaches = new HashMap<>();
    values.forEach((field, value) -> {
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("before", null);
      // Store reference names now so later catalog edits do not rewrite creation history.
      boolean reference = REFERENCE_TABLES.containsKey(field);
      entry.put("after", reference ? resolveReferenceName(field, value, referenceCaches) : value);
      snapshot.put(reference ? field.replace("ID", "") : field, entry);
    });
    return snapshot;
  }

  @org.springframework.transaction.annotation.Transactional
  public void record(
      SlabInventory slab,
      String operationType,
      String beforeStatus,
      String afterStatus,
      String standardReason,
      String detailReason,
      String operationSource,
      Map<String, ?> changes) {
    boolean externalOperation = EXTERNAL_API_SOURCE.equals(operationSource);
    CurrentIdentity identity = identityProvider.require();
    LocalDateTime now = LocalDateTime.now();
    SlabOperationLog log = new SlabOperationLog();
    log.setBusinessClientCode(identity == null ? "admin" : identity.clientCode());
    log.setOperatorClientCode(identity == null ? null : identity.clientCode());
    log.setOperatorIdentityId(identity == null ? null : identity.identityId());
    log.setProductCreatedByAccountId(slab.getCreatedByAccountId());
    log.setSlabId(slab.getId());
    log.setSlabSerialNo(slab.getSerialNo() == null ? "" : slab.getSerialNo());
    log.setSlabName(slab.getName());
    log.setPublisherType(slab.getPublisherType());
    log.setOperationType(operationType);
    log.setBeforeStatus(beforeStatus);
    log.setAfterStatus(afterStatus);
    log.setStandardReason(standardReason);
    log.setDetailReason(detailReason);
    Map<String,Object> visibleChanges = new LinkedHashMap<>(changes);
    if (identity != null && "supply-chain".equals(identity.clientCode())) {
      visibleChanges.keySet().removeIf(key -> key.contains("指导价") || key.contains("价格") || key.endsWith("来源配置ID") || key.contains("加价"));
    }
    if (List.of("UPDATE", "PRICE_UPDATE").contains(operationType)) {
      Map<String, Object> changed = SlabLogChanges.retainChanged(visibleChanges);
      visibleChanges.clear();
      visibleChanges.putAll(changed);
      if (visibleChanges.isEmpty()) { return; }
    }
    log.setOperationSummary(operationSummary(operationType, beforeStatus, visibleChanges));
    log.setChangeDetails(serializeChanges(visibleChanges));
    log.setOperationSource(operationSource);
    log.setOperatorName(externalOperation ? "外部系统" : identity.displayName());
    log.setOperatorAccountId(externalOperation ? null : identity.accountId());
    log.setOperatedAt(now);
    log.setCreatedAt(now);
    save(log);
    retainSnapshot(log.getId(), changes);
  }

  public static String operationSummary(String type, String beforeStatus, Map<String, ?> changes) {
    return switch (type) {
      case "CREATE" -> "发布商品";
      case "SHELF" -> "上架商品";
      case "OFF_SHELF" -> "下架商品";
      case "RESTORE_WAREHOUSE" -> "放回仓库";
      case "RESTORE_RECYCLE" -> "放回仓库";
      case "DELETE_TO_RECYCLE" -> "删除至回收站";
      case "PHYSICAL_DELETE" -> "物理删除大板";
      case "PURGE" -> "彻底删除商品";
      case "SOLD_OUT" -> "商品售罄";
      case "SOURCE_OFF_SHELF" -> "供应链已下架该商品";
      case "SOURCE_DELETE_TO_RECYCLE" -> "供应链已将该商品删除至回收站";
      case "SOURCE_PURGE" -> "供应链已彻底删除该商品";
      case "SOURCE_INTERNAL" -> "供应链状态变更";
      case "UPDATE" -> "编辑商品";
      case "PRICE_UPDATE" -> changes.containsKey("价格联动") ? "供应链成本变更，按当前系数重算售价" : "修改价格";
      case "SOURCE_SHELF" -> beforeStatus == null ? "供应链已上架，商品进入运营管理平台仓库" : "来源重新上架，解除遮罩并保留运营状态";
      default -> "修改大板状态";
    };
  }

  public void retainSnapshot(Long logId, Map<String, ?> changes) {
    Map<String, Long> historicalMedia = new LinkedHashMap<>();
    changes.forEach((field, value) -> {
      if (!MEDIA_TYPES.containsKey(field) || !(value instanceof Map<?, ?> change)) {
        return;
      }
      for (String side : List.of("before", "after")) {
        Long mediaId = parseId(change.get(side));
        if (mediaId != null) {
          historicalMedia.put(field + ":" + side, mediaId);
        }
      }
    });
    historyService.retain("SLAB_LOG", logId, historicalMedia);
  }

  private String buildWhereClause(
      String keyword,
      String operationType,
      String operatorName,
      LocalDate startDate,
      LocalDate endDate,
      List<Object> parameters) {
    List<String> conditions = new ArrayList<>();
    conditions.add("(" + VISIBLE_TYPE + ") <> 'SOURCE_INTERNAL'");
    conditions.add("business_client_code=?");
    parameters.add(identityProvider.require().clientCode());
    if (!com.zdm.platform.security.DataScope.isAll(identityProvider.require())) {
      conditions.add("product_created_by_account_id = ?");
      parameters.add(identityProvider.require().accountId());
    }
    if (keyword != null && !keyword.isBlank()) {
      String normalizedKeyword = "%" + keyword.trim() + "%";
      conditions.add("(slab_name LIKE ? OR slab_serial_no LIKE ? OR CAST(slab_id AS CHAR) LIKE ?)");
      parameters.add(normalizedKeyword);
      parameters.add(normalizedKeyword);
      parameters.add(normalizedKeyword);
    }
    if (operationType != null && !operationType.isBlank()) {
      if ("RESTORE".equals(operationType.trim())) {
        conditions.add("(" + VISIBLE_TYPE + ") IN ('RESTORE','RESTORE_WAREHOUSE','RESTORE_RECYCLE')");
      } else {
        conditions.add("(" + VISIBLE_TYPE + ") = ?");
        parameters.add(operationType.trim());
      }
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
