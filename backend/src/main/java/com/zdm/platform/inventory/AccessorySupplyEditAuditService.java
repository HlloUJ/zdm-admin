package com.zdm.platform.inventory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zdm.platform.media.MediaHistoryService;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** One immutable edit event, projected into each affected client's audit history. */
@Service
public class AccessorySupplyEditAuditService {
  private static final Set<String> SALES = Set.of("销售规格", "规格维度", "销售属性名称", "指导价", "层级价格", "总库存");
  private static final Set<String> SYSTEM = Set.of("状态", "下架原因", "详细说明", "下架时间", "创建人", "创建时间", "商品ID", "发布类型");
  @org.springframework.beans.factory.annotation.Autowired
  private AccessoryStateActivityService stateActivities;
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final CurrentIdentityProvider identities;
  private final MediaHistoryService history;
  private final StoreAccessorySalePriceService salePrices;

  public AccessorySupplyEditAuditService(JdbcTemplate jdbc, ObjectMapper json, CurrentIdentityProvider identities, MediaHistoryService history, StoreAccessorySalePriceService salePrices) {
    this.jdbc = jdbc; this.json = json; this.identities = identities; this.history = history; this.salePrices = salePrices;
  }

  record StoreSnapshot(long id, long tenantId, long storeId, String status, JsonNode snapshot) {}
  record EditContext(JsonNode before, String sourceStatus, boolean operationsActive, List<StoreSnapshot> stores) {}

  EditContext prepare(AccessoryProduct product, Map<String, Object> before) {
    JsonNode snapshot = json.valueToTree(before);
    boolean active = Boolean.TRUE.equals(jdbc.queryForObject("SELECT operations_deleted=FALSE AND operations_invalidated_at IS NULL FROM accessory_products WHERE id=?", Boolean.class, product.getId()));
    jdbc.queryForList("SELECT DISTINCT store_id FROM store_accessory_products WHERE accessory_product_id=? AND invalidated_at IS NULL ORDER BY store_id", product.getId())
        .forEach(row -> salePrices.lockCategories(((Number) row.get("store_id")).longValue()));
    var stores = jdbc.query("""
        SELECT listing.id,listing.tenant_id,listing.store_id,listing.status,store.store_level_id
        FROM store_accessory_products listing JOIN stores store ON store.id=listing.store_id
        JOIN accessory_products product ON product.id=listing.accessory_product_id
        WHERE listing.accessory_product_id=? AND listing.invalidated_at IS NULL
          AND listing.selection_generation=product.selection_generation
        ORDER BY listing.id FOR UPDATE
        """, (row, index) -> new StoreSnapshot(row.getLong("id"), row.getLong("tenant_id"), row.getLong("store_id"), row.getString("status"),
            storeSnapshot(snapshot, row.getLong("id"), row.getObject("store_level_id", Long.class))), product.getId());
    return new EditContext(snapshot, product.getSourceStatus(), active, stores);
  }

  void record(AccessoryProduct product, EditContext context, Map<String, Object> afterMap) {
    JsonNode after = json.valueToTree(afterMap);
    Set<String> changed = new LinkedHashSet<>();
    after.fieldNames().forEachRemaining(key -> {
      if (!SYSTEM.contains(key) && !Objects.equals(context.before().get(key), after.get(key))) { changed.add(key); }
    });
    // Presentation order belongs to its corresponding product/sales attributes.
    changed.remove("字段顺序");
    if (!Objects.equals(context.before().path("字段顺序").path("sales"), after.path("字段顺序").path("sales"))) { changed.add("销售属性名称"); }
    if (!Objects.equals(context.before().path("字段顺序").path("product"), after.path("字段顺序").path("product"))) { changed.add("商品属性"); }
    boolean statusChanged = !Objects.equals(context.sourceStatus(), product.getSourceStatus());
    if (changed.isEmpty() && !statusChanged) { return; }
    boolean sales = changed.stream().anyMatch(SALES::contains);
    boolean info = changed.stream().anyMatch(key -> !SALES.contains(key));
    String subject = info && sales ? "商品信息及销售规格" : sales ? "商品销售规格" : "商品信息";
    String event = UUID.randomUUID().toString();
    // Product log APIs use UTC; store log APIs use Beijing wall time. Read one instant
    // independently of JVM and database session zones, then encode each existing contract.
    LocalDateTime time = Objects.requireNonNull(jdbc.queryForObject("SELECT UTC_TIMESTAMP",
        (row, index) -> row.getObject(1, LocalDateTime.class)), "Database UTC timestamp is required");
    LocalDateTime storeTime = time.atOffset(java.time.ZoneOffset.UTC)
        .atZoneSameInstant(java.time.ZoneId.of("Asia/Shanghai")).toLocalDateTime();
    var actor = identities.require();
    ObjectNode sourceBefore = (ObjectNode) context.before().deepCopy();
    ObjectNode sourceAfter = (ObjectNode) after.deepCopy();
    sourceBefore.put("状态", context.sourceStatus()); sourceAfter.put("状态", product.getSourceStatus());
    sourceBefore.remove(List.of("指导价", "层级价格")); sourceAfter.remove(List.of("指导价", "层级价格"));
    writeProductLog(product, "supply-chain", "UPDATE", changed.isEmpty() ? "编辑商品" : "该" + subject + "已被修改", sourceBefore, sourceAfter, changed, sales, event, time);
    if (changed.isEmpty()) { return; }
    if (context.operationsActive()) {
      writeProductLog(product, "admin", "SOURCE_UPDATE", "该" + subject + "已被供应链修改", context.before(), after, changed, sales, event, time);
    }
    for (StoreSnapshot store : context.stores()) {
      Long level = jdbc.queryForObject("SELECT store_level_id FROM stores WHERE id=?", Long.class, store.storeId());
      String nextStatus = sales ? salePrices.synchronizeSupplyEdit(store.id(), after, actor.accountId(), storeTime) : store.status();
      JsonNode next = storeSnapshot(after, store.id(), level);
      ObjectNode changes = changes(store.snapshot(), next, changed, sales, event);
      if (!Objects.equals(store.status(), nextStatus)) {
        changes.set("状态", json.createObjectNode().put("before", store.status()).put("after", nextStatus));
        changes.set("下架原因", json.createObjectNode().putNull("before").put("after", StoreAccessorySalePriceService.ATTENTION));
      }
      if (sales) { changes.set("售价待补齐", json.createObjectNode().put("before", store.snapshot().path("售价待补齐").asBoolean()).put("after", next.path("售价待补齐").asBoolean())); }
      jdbc.update("""
          INSERT INTO store_accessory_operation_logs(tenant_id,store_id,listing_id,accessory_product_id,product_name,
            operation_type,operation_summary,before_status,after_status,change_details,operator_account_id,operator_name,operated_at)
          VALUES(?,?,?,?,?,'SOURCE_UPDATE',?,?,?,?,?,?,?)
          """, store.tenantId(), store.storeId(), store.id(), product.getId(), product.getName(), "该" + subject + "已被供应链修改",
          store.status(), nextStatus, changes.toString(), actor.accountId(), actor.displayName(), storeTime);
      stateActivities.record("store-accessory","store",store.id(),store.status(),nextStatus,actor.accountId(),actor.clientCode());
      Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
      retain("STORE_ACCESSORY_PRODUCT_LOG", id, store.snapshot(), next);
    }
  }

  private JsonNode storeSnapshot(JsonNode source, long listing, Long level) {
    ObjectNode result = (ObjectNode) source.deepCopy();
    result.remove(List.of("供应商", "状态", "下架原因", "详细说明", "下架时间"));
    var tiers = json.createArrayNode();
    source.path("层级价格").forEach(price -> {
      if (level != null && price.path("storeLevelId").asLong() == level) {
        ObjectNode safe = json.createObjectNode();
        for (String field : List.of("skuId", "variantLabel", "storeLevelId", "storeLevelName", "price")) { safe.set(field, price.path(field)); }
        tiers.add(safe);
      }
    });
    result.set("层级价格", tiers);
    var guides = json.createArrayNode();
    source.path("指导价").forEach(price -> {
      ObjectNode safe = json.createObjectNode();
      for (String field : List.of("skuId", "variantLabel", "price")) { safe.set(field, price.path(field)); }
      guides.add(safe);
    });
    result.set("指导价", guides);
    Map<String,Object> listingRow = jdbc.queryForMap("SELECT store_id,store_category_id,sale_price_attention FROM store_accessory_products WHERE id=?", listing);
    result.put("售价待补齐", Boolean.TRUE.equals(listingRow.get("sale_price_attention")) || listingRow.get("sale_price_attention") instanceof Number n && n.intValue() != 0);
    Long storeId = ((Number) listingRow.get("store_id")).longValue();
    Long categoryId = listingRow.get("store_category_id") instanceof Number number ? number.longValue() : null;
    var pricing = salePrices.context(storeId, List.of(listing));
    source.path("销售规格").forEach(value -> {
      ObjectNode sku = (ObjectNode) value;
      // Work only on the deep copy; no supplier costs survive in store history.
      ObjectNode safe = null;
      for (JsonNode copy : result.path("销售规格")) {
        if (Objects.equals(copy.get("skuId"), sku.get("skuId"))) { safe = (ObjectNode) copy; break; }
      }
      if (safe == null) { return; }
      safe.remove(List.of("costPrice", "costPriceCoefficient"));
      ObjectNode row = safe;
      JsonNode tier = null;
      for (JsonNode price : tiers) { if (price.path("skuId").asLong() == sku.path("skuId").asLong()) { tier = price; break; } }
      java.math.BigDecimal base = tier != null && tier.path("price").isNumber() ? tier.path("price").decimalValue() : null;
      var effective = pricing.effective(listing, sku.path("skuId").asLong(), categoryId, base);
      row.set("salePrice", json.valueToTree(effective.amount()));
      row.set("saleCoefficient", json.valueToTree(effective.coefficient()));
      row.put("priceMode", effective.mode());
    });
    return result;
  }

  private ObjectNode changes(JsonNode before, JsonNode after, Set<String> changed, boolean sales, String event) {
    ObjectNode result = json.createObjectNode();
    Set<String> fields = new LinkedHashSet<>(changed);
    fields.removeAll(SYSTEM);
    if (sales) { fields.addAll(List.of("销售规格", "规格维度", "销售属性名称", "指导价", "层级价格")); }
    if (fields.contains("宝贝详情")) { fields.add("媒体"); }
    if (sales || fields.contains("商品属性")) { fields.add("字段顺序"); }
    for (String field : fields) {
      if (!before.has(field) && !after.has(field)) { continue; }
      ObjectNode value = result.putObject(field);
      value.set("before", before.path(field)); value.set("after", after.path(field));
      value.put("eventId", event);
      if ("商品分类".equals(field)) { value.put("pathRecorded", true); }
      if ("销售规格".equals(field)) { value.put("supplyEdit", true); }
    }
    return result;
  }

  private void writeProductLog(AccessoryProduct product, String client, String type, String summary,
      JsonNode before, JsonNode after, Set<String> changed, boolean sales, String event, LocalDateTime time) {
    var actor = identities.require();
    ObjectNode details = changes(before,after,changed,sales,event);
    if ("supply-chain".equals(client) && !Objects.equals(before.get("状态"), after.get("状态"))) {
      ObjectNode status = details.putObject("状态");
      status.set("before", before.path("状态")); status.set("after", after.path("状态")); status.put("eventId", event);
    }
    jdbc.update("""
        INSERT INTO accessory_operation_logs(product_id,product_name,merchant_code,publisher_type,product_created_by_account_id,
          business_client_code,operator_client_code,operator_identity_id,operation_type,operation_summary,
          before_status,after_status,change_details,operation_source,operator_name,operator_account_id,operated_at,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'MANUAL',?,?,?,?)
        """, product.getId(),product.getName(),product.getSku(),product.getPublisherType(),product.getCreatedByAccountId(),
        client,actor.clientCode(),actor.identityId(),type,summary,before.path("状态").asText(),after.path("状态").asText(),
        details.toString(),actor.displayName(),actor.accountId(),time,time);
    stateActivities.record("accessory",client,product.getId(),before.path("状态").asText(),after.path("状态").asText(),actor.accountId(),actor.clientCode());
    Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
    retain("ACCESSORY_PRODUCT_LOG", id, before, after);
  }

  private void retain(String domain, Long id, JsonNode before, JsonNode after) {
    Map<String,Long> refs = new LinkedHashMap<>();
    for (String side : List.of("before", "after")) { (side.equals("before") ? before : after).path("媒体").forEach(media -> refs.put(side+":"+media.path("field").asText(),media.path("mediaId").asLong())); }
    history.retain(domain,id,refs);
  }
}
