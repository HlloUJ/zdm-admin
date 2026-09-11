package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zdm.platform.media.MediaHistoryService;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.jdbc.core.BeanPropertyRowMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FinishedOperationLogService extends ServiceImpl<FinishedOperationLogMapper, FinishedOperationLog> {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final CurrentIdentityProvider identities;
  private final MediaHistoryService history;

  public FinishedOperationLogService(JdbcTemplate jdbc, ObjectMapper json,
      CurrentIdentityProvider identities, MediaHistoryService history) {
    this.jdbc = jdbc;
    this.json = json;
    this.identities = identities;
    this.history = history;
  }

  public Map<String, Object> snapshot(FinishedProduct product) {
    Map<String, Object> values = new LinkedHashMap<>();
    values.put("商品名称", product.getName());
    values.put("商品ID", product.getId());
    values.put("商品分类", categoryPath(product.getCategoryId()));
    values.put("商品属性", cleanRows(product.getAttributes()));
    values.put("商家编码", product.getSku());
    values.put("供应商", name("suppliers", product.getSupplierId()));
    values.put("总库存", product.getTotalStock());
    values.put("状态", product.getStatus());
    values.put("发布类型", product.getPublisherType());
    values.put("创建人", product.getCreatedByName());
    values.put("创建时间", product.getCreatedAt());
    values.put("下架原因", product.getOffShelfReason());
    values.put("详细说明", product.getOffShelfDetail());
    values.put("下架时间", product.getOffShelfAt());
    values.put("规格维度", product.getSpecDimensions());
    values.put("销售规格", cleanRows(product.getVariants()));
    values.put("销售属性名称", salesAttributeNames(json.valueToTree(product.getVariants())));
    values.put("指导价", cleanRows(product.getGuidePrices()));
    values.put("层级价格", cleanRows(product.getMarkupPrices()));
    // Retain the normalized rich text and media IDs, never transient response URLs.
    values.put("宝贝详情", jdbc.queryForObject("SELECT detail FROM finished_products WHERE id=?", String.class, product.getId()));
    List<Map<String, Object>> media = new ArrayList<>();
    jdbc.query("SELECT field_key,media_id FROM media_references WHERE business_domain='FINISHED_PRODUCT' AND business_id=? ORDER BY field_key", row -> {
      media.add(Map.of("field", row.getString(1), "mediaId", row.getLong(2)));
    }, product.getId());
    values.put("媒体", media);
    return values;
  }

  private Map<String, String> salesAttributeNames(JsonNode variants) {
    Map<String, String> result = new LinkedHashMap<>();
    variants.forEach(variant -> variant.path("salesAttributes").fieldNames().forEachRemaining(key -> {
      if (result.containsKey(key) || !key.matches("attribute_[0-9]+")) { return; }
      Long id = Long.valueOf(key.substring("attribute_".length()));
      List<String> names = jdbc.queryForList("SELECT name FROM product_attributes WHERE id=?", String.class, id);
      if (!names.isEmpty()) { result.put(key, names.getFirst()); }
    }));
    return result;
  }

  private String categoryPath(Long id) {
    if (id == null) { return null; }
    List<String> names = new ArrayList<>();
    java.util.Set<Long> visited = new java.util.HashSet<>();
    Long current = id;
    while (current != null && current != 0 && visited.add(current)) {
      List<Map<String, Object>> rows = jdbc.queryForList("SELECT name,parent_id FROM product_categories WHERE id=? AND scope='finished' AND tenant_id IS NULL", current);
      if (rows.isEmpty()) { names.addFirst("历史上级类目已不可用"); break; }
      names.addFirst((String) rows.getFirst().get("name"));
      Object parent = rows.getFirst().get("parent_id");
      current = parent instanceof Number number ? number.longValue() : null;
    }
    return String.join(" / ", names);
  }

  private void resolveLegacyCategory(ObjectNode changes, Long productId) {
    JsonNode category = changes.path("商品分类");
    if (!(category instanceof ObjectNode field) || field.path("pathRecorded").asBoolean()) { return; }
    for (String side : List.of("before", "after")) {
      String leaf = field.path(side).asText("");
      if (leaf.isBlank()) { continue; }
      List<Long> ids = jdbc.queryForList("SELECT id FROM product_categories WHERE name=? AND scope='finished' AND tenant_id IS NULL", Long.class, leaf);
      boolean matchedProduct = false;
      if (ids.size() > 1) {
        ids = jdbc.queryForList("SELECT c.id FROM product_categories c JOIN finished_products p ON p.category_id=c.id WHERE p.id=? AND c.name=? AND c.scope='finished' AND c.tenant_id IS NULL", Long.class, productId, leaf);
        matchedProduct = ids.size() == 1;
      }
      if (ids.size() == 1) {
        String path = categoryPath(ids.getFirst());
        if (!leaf.equals(path)) {
          field.put(side, path);
          field.put("hint", matchedProduct ? "此历史日志仅保存末级名称，完整层级按商品当前关联类目补全" : "此历史日志仅保存末级名称，完整层级按当前唯一匹配类目补全");
        }
      }
    }
  }

  private String name(String table, Long id) {
    if (id == null) { return null; }
    // Table names originate only from the two constants in snapshot().
    List<String> names = jdbc.queryForList("SELECT name FROM " + table + " WHERE id=?", String.class, id);
    return names.isEmpty() ? "已删除或不可用" : names.getFirst();
  }

  private JsonNode cleanRows(Object rows) {
    JsonNode result = json.valueToTree(rows);
    if (result.isArray()) {
      result.forEach(row -> {
        if (row instanceof ObjectNode object) {
          object.remove(List.of("id", "finishedProductId", "createdAt", "updatedAt"));
        }
      });
    }
    return result;
  }

  @Transactional
  public void record(FinishedProduct product, Map<String, Object> before, Map<String, Object> after) {
    Map<String, Object> changes = new LinkedHashMap<>();
    Map<String, Object> source = after == null ? before : after;
    source.forEach((key, value) -> {
      Object old = before == null ? null : before.get(key);
      Object next = after == null ? null : value;
      if (before == null || after == null || !Objects.equals(json.valueToTree(old), json.valueToTree(next))) {
        Map<String, Object> change = new LinkedHashMap<>();
        change.put("before", old);
        change.put("after", next);
        if ("商品分类".equals(key)) { change.put("pathRecorded", true); }
        changes.put(key, change);
      }
    });
    if (changes.isEmpty()) { return; }
    String previousStatus = before == null ? null : (String) before.get("状态");
    String nextStatus = after == null ? null : (String) after.get("状态");
    String type = operationType(before, after, previousStatus, nextStatus, changes);
    if (before != null && after != null) { retainChangedVariants(before, after, changes); }
    Map<String, String> labels = Map.of("CREATE", "创建商品", "UPDATE", "编辑商品",
        "PRICE_UPDATE", "修改价格", "SHELF", "上架商品", "OFF_SHELF", "下架商品",
        "RESTORE", "放回仓库", "DELETE_TO_RECYCLE", "删除至回收站", "PURGE", "彻底删除商品", "SOLD_OUT", "商品售罄");
    var identity = identities.require();
    FinishedOperationLog log = new FinishedOperationLog();
    log.setProductCreatedByAccountId(product.getCreatedByAccountId());
    log.setProductId(product.getId());
    log.setProductName(product.getName());
    log.setMerchantCode(product.getSku());
    log.setPublisherType(product.getPublisherType());
    log.setOperationType(type);
    log.setOperationSummary(labels.get(type));
    log.setBeforeStatus(previousStatus);
    log.setAfterStatus(nextStatus);
    log.setStandardReason(product.getOffShelfReason());
    log.setDetailReason(product.getOffShelfDetail());
    log.setOperationSource("MANUAL");
    log.setOperatorName(identity.displayName());
    log.setOperatorAccountId(identity.accountId());
    log.setOperatedAt(LocalDateTime.now());
    log.setCreatedAt(log.getOperatedAt());
    try { log.setChangeDetails(json.writeValueAsString(changes)); }
    catch (com.fasterxml.jackson.core.JsonProcessingException error) { throw new IllegalStateException("商品操作日志保存失败", error); }
    save(log);
    Map<String, Long> references = new LinkedHashMap<>();
    retainMedia(before, "before", references);
    retainMedia(after, "after", references);
    history.retain("FINISHED_PRODUCT_LOG", log.getId(), references);
  }

  // Keep complete historical data only for variants whose data or prices changed.
  void retainChangedVariants(Map<String, Object> before, Map<String, Object> after,
      Map<String, Object> changes) {
    List<String> fields = List.of("销售规格", "指导价", "层级价格");
    if (fields.stream().noneMatch(changes::containsKey) && !changes.containsKey("规格维度")) { return; }
    Map<String, Map<String, JsonNode>> oldRows = variantBundles(before, fields);
    Map<String, Map<String, JsonNode>> newRows = variantBundles(after, fields);
    java.util.Set<String> changed = new java.util.LinkedHashSet<>(oldRows.keySet());
    changed.addAll(newRows.keySet());
    if (!changes.containsKey("规格维度")) {
      changed.removeIf(key -> Objects.equals(oldRows.get(key), newRows.get(key)));
    }
    for (String field : fields) {
      Map<String, Object> sides = new LinkedHashMap<>();
      for (String side : List.of("before", "after")) {
        Map<String, Object> snapshot = side.equals("before") ? before : after;
        var selected = json.createArrayNode();
        JsonNode rows = json.valueToTree(snapshot.get(field));
        if (rows != null && rows.isArray()) {
          rows.forEach(row -> {
            if (changed.contains(row.path("variantKey").asText())) { selected.add(row); }
          });
        }
        sides.put(side, selected);
      }
      changes.put(field, sides);
    }
    for (String field : List.of("规格维度", "销售属性名称")) {
      Map<String, Object> sides = new LinkedHashMap<>();
      sides.put("before", before.get(field));
      sides.put("after", after.get(field));
      changes.put(field, sides);
    }
  }

  private Map<String, Map<String, JsonNode>> variantBundles(Map<String, Object> snapshot, List<String> fields) {
    Map<String, Map<String, JsonNode>> bundles = new LinkedHashMap<>();
    for (String field : fields) {
      JsonNode rows = json.valueToTree(snapshot.get(field));
      if (rows == null || !rows.isArray()) { continue; }
      rows.forEach(row -> {
        String key = row.path("variantKey").asText();
        String entry = field.equals("层级价格") ? field + ":" + row.path("storeLevelId").asText() : field;
        bundles.computeIfAbsent(key, ignored -> new LinkedHashMap<>()).put(entry, row);
      });
    }
    return bundles;
  }

  private void retainMedia(Map<String, Object> snapshot, String side, Map<String, Long> refs) {
    if (snapshot == null) { return; }
    JsonNode media = json.valueToTree(snapshot.get("媒体"));
    media.forEach(item -> refs.put(side + ":" + item.path("field").asText(), item.path("mediaId").asLong()));
  }

  private String operationType(Map<String, Object> before, Map<String, Object> after,
      String oldStatus, String status, Map<String, Object> changes) {
    if (before == null) { return "CREATE"; }
    if (after == null) { return "PURGE"; }
    if (!Objects.equals(oldStatus, status)) {
      return switch (status) {
        case "selling" -> "SHELF";
        case "offShelf" -> "OFF_SHELF";
        case "warehouse" -> "RESTORE";
        case "recycle" -> "DELETE_TO_RECYCLE";
        case "soldOut" -> "SOLD_OUT";
        default -> "UPDATE";
      };
    }
    return changes.keySet().stream().allMatch(key -> List.of("指导价", "层级价格").contains(key)) ? "PRICE_UPDATE" : "UPDATE";
  }

  public FinishedOperationLogPage listPage(String keyword, String type, String operator,
      LocalDate start, LocalDate end, int requestedPage, int requestedSize) {
    int page = Math.max(1, requestedPage);
    int size = Math.clamp(requestedSize, 1, 100);
    List<String> conditions = new ArrayList<>();
    List<Object> args = new ArrayList<>();
    if (!com.zdm.platform.security.DataScope.isAll(identities.require())) {
      conditions.add("product_created_by_account_id = ?");
      args.add(identities.require().accountId());
    }
    if (keyword != null && !keyword.isBlank()) {
      conditions.add("(product_name LIKE ? OR merchant_code LIKE ? OR CAST(product_id AS CHAR) LIKE ?)");
      for (int i = 0; i < 3; i++) { args.add("%" + keyword.trim() + "%"); }
    }
    if (type != null && !type.isBlank()) { conditions.add("operation_type=?"); args.add(type); }
    if (operator != null && !operator.isBlank()) { conditions.add("operator_name LIKE ?"); args.add("%" + operator.trim() + "%"); }
    if (start != null) { conditions.add("operated_at>=?"); args.add(start.atStartOfDay()); }
    if (end != null) { conditions.add("operated_at<?"); args.add(end.plusDays(1).atStartOfDay()); }
    String where = conditions.isEmpty() ? "" : " WHERE " + String.join(" AND ", conditions);
    Long count = jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs" + where, Long.class, args.toArray());
    args.add(size);
    args.add((page - 1) * size);
    List<FinishedOperationLog> records = jdbc.query("SELECT * FROM finished_operation_logs" + where
        + " ORDER BY operated_at DESC,id DESC LIMIT ? OFFSET ?", BeanPropertyRowMapper.newInstance(FinishedOperationLog.class), args.toArray());
    return new FinishedOperationLogPage(records, count == null ? 0 : count, page, size);
  }

  public FinishedOperationLog detail(Long id) {
    FinishedOperationLog log = getById(id);
    if (log == null) { throw new IllegalArgumentException("操作日志不存在"); }
    com.zdm.platform.security.DataScope.requireAccess(identities.require(), log.getProductCreatedByAccountId());
    try {
      ObjectNode changes = (ObjectNode) json.readTree(log.getChangeDetails());
      resolveLegacyCategory(changes, log.getProductId());
      if (!changes.has("销售属性名称") && changes.has("销售规格")) {
        ObjectNode names = changes.putObject("销售属性名称");
        for (String side : List.of("before", "after")) {
          names.set(side, json.valueToTree(salesAttributeNames(changes.path("销售规格").path(side))));
        }
      }

      if (changes.has("宝贝详情") && !changes.has("媒体")) {
        ObjectNode context = changes.putObject("媒体");
        for (String side : List.of("before", "after")) {
          var media = context.putArray(side);
          jdbc.query("SELECT field_key,media_id FROM media_references WHERE business_domain='FINISHED_PRODUCT_LOG' AND business_id=? AND reference_kind='HISTORY' AND field_key LIKE ? ORDER BY field_key", row -> {
            media.addObject().put("field", row.getString(1).substring(side.length() + 1)).put("mediaId", row.getLong(2));
          }, id, side + ":%");
        }
      }
      JsonNode mediaChanges = changes.path("媒体");
      for (String side : List.of("before", "after")) {
        for (JsonNode item : mediaChanges.path(side)) {
          long mediaId = item.path("mediaId").asLong();
          List<String> types = jdbc.queryForList("SELECT media_type FROM media_assets WHERE id=?", String.class, mediaId);
          ((ObjectNode) item).set("resource", json.valueToTree(history.view(mediaId, types.isEmpty() ? "image" : types.getFirst())));
        }
      }
      log.setChangeDetails(json.writeValueAsString(changes));
    } catch (com.fasterxml.jackson.core.JsonProcessingException error) { throw new IllegalStateException("操作日志读取失败", error); }
    return log;
  }
}
