package com.zdm.platform.inventory;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zdm.platform.media.MediaHistoryService;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Immutable, store-visible selection history; never reads current prices when displaying a log. */
@Service
public class StoreFinishedSelectionSnapshot {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final MediaHistoryService history;

  public StoreFinishedSelectionSnapshot(JdbcTemplate jdbc, ObjectMapper json, MediaHistoryService history) {
    this.jdbc = jdbc;
    this.json = json;
    this.history = history;
  }

  public record SnapshotSku(Long skuId, String variantLabel, Integer stock, String displayMode,
      Map<String, String> salesAttributes, String material, String lengthValue, String color, String sizeValue) {
    public SnapshotSku {
      salesAttributes = salesAttributes == null ? null
          : java.util.Collections.unmodifiableMap(new LinkedHashMap<>(salesAttributes));
    }

    public Map<String, String> salesAttributes() {
      return salesAttributes == null ? null
          : java.util.Collections.unmodifiableMap(new LinkedHashMap<>(salesAttributes));
    }
  }

  public Map<String, Object> capture(StoreFinishedProductService.PoolDetail product, Long levelId) {
    Map<String, Object> snapshot = new LinkedHashMap<>();
    snapshot.put("商品名称", product.name());
    snapshot.put("商品ID", product.id());
    snapshot.put("商家编码", product.merchantCode());
    snapshot.put("商品分类", product.categoryName());
    snapshot.put("商品属性", product.attributes());
    snapshot.put("总库存", product.totalStock());
    snapshot.put("门店级别", product.storeLevelName());
    snapshot.put("规格维度", product.specDimensions());
    snapshot.put("销售属性名称", product.attributeNames());
    snapshot.put("销售规格", product.skus().stream().map(sku -> new SnapshotSku(sku.skuId(),
        sku.label(), sku.stock(), sku.displayMode(), sku.salesAttributes(), sku.material(),
        sku.lengthValue(), sku.color(), sku.sizeValue())).toList());
    snapshot.put("指导价", product.skus().stream().map(sku -> price(sku.skuId(), sku.guidePrice(), null, null)).toList());
    snapshot.put("层级价格", levelId == null ? List.of() : product.skus().stream()
        .map(sku -> price(sku.skuId(), sku.partnerPrice(), levelId, product.storeLevelName())).toList());
    snapshot.put("宝贝详情", jdbc.queryForObject("SELECT detail FROM finished_products WHERE id=?", String.class, product.id()));
    List<Map<String, Object>> media = jdbc.query("""
        SELECT field_key, media_id FROM media_references
        WHERE business_domain='FINISHED_PRODUCT' AND business_id=? ORDER BY field_key
        """, (row, index) -> Map.<String, Object>of("field", row.getString(1), "mediaId", row.getLong(2)), product.id());
    snapshot.put("媒体", media);
    return snapshot;
  }

  private Map<String, Object> price(Long skuId, java.math.BigDecimal amount, Long levelId, String levelName) {
    Map<String, Object> value = new LinkedHashMap<>();
    value.put("skuId", skuId);
    value.put("price", amount);
    if (levelId != null) {
      value.put("storeLevelId", levelId);
      value.put("storeLevelName", levelName);
    }
    return value;
  }

  public void retain(Long logId, Map<String, Object> snapshot) {
    Map<String, Long> references = new LinkedHashMap<>();
    json.valueToTree(snapshot.get("媒体")).forEach(item ->
        references.put("after:" + item.path("field").asText(), item.path("mediaId").asLong()));
    history.retain("STORE_FINISHED_PRODUCT_LOG", logId, references);
  }

  public String withoutSupplier(String details) {
    if (details == null) { return null; }
    try {
      ObjectNode snapshot = (ObjectNode) json.readTree(details);
      snapshot.remove(List.of("供应商", "supplierId", "supplierName", "supplier"));
      return json.writeValueAsString(snapshot);
    } catch (JsonProcessingException error) {
      throw new IllegalStateException("门店日志读取失败", error);
    }
  }

  public String resolve(String details) {
    if (details == null) { return null; }
    try {
      ObjectNode snapshot = (ObjectNode) json.readTree(details);
      for (var item : snapshot.path("媒体")) {
        long mediaId = item.path("mediaId").asLong();
        List<String> types = jdbc.queryForList("SELECT media_type FROM media_assets WHERE id=?", String.class, mediaId);
        ((ObjectNode) item).set("resource", json.valueToTree(history.view(mediaId, types.isEmpty() ? "image" : types.getFirst())));
      }
      return json.writeValueAsString(snapshot);
    } catch (JsonProcessingException error) {
      throw new IllegalStateException("门店挑选日志读取失败", error);
    }
  }
}
