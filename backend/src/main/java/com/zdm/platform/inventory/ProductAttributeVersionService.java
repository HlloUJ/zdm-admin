package com.zdm.platform.inventory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Attribute definitions belong to the source product, never to the latest category template. */
@Service
public class ProductAttributeVersionService {
  public record Binding(Long id, Integer revision, JsonNode content) {
    public Binding { content = content.deepCopy(); }
    public JsonNode content() { return content.deepCopy(); }
  }
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final CurrentIdentityProvider identities;

  public ProductAttributeVersionService(JdbcTemplate jdbc, ObjectMapper json, CurrentIdentityProvider identities) {
    this.jdbc = jdbc;
    this.json = json;
    this.identities = identities;
  }

  Binding bind(String scope, Long categoryId, Long versionId, Integer revision) {
    if (versionId == null || revision == null) { throw new IllegalArgumentException("请选择已发布的属性模板版本"); }
    var identity = identities.require();
    var rows = jdbc.query("""
        SELECT v.id,v.revision,v.content FROM category_template_versions v
        JOIN product_categories c ON c.id=v.category_id
        WHERE v.id=? AND v.category_id=? AND v.state='published'
          AND c.scope=? AND c.tenant_id IS NULL AND c.status='enabled'
          AND (? OR v.created_by_account_id=?) FOR SHARE
        """, (row, index) -> {
          try { return new Binding(row.getLong(1), row.getInt(2), json.readTree(row.getString(3))); }
          catch (java.io.IOException e) { throw new IllegalStateException("属性模板读取失败", e); }
        }, versionId, categoryId, scope, com.zdm.platform.security.DataScope.isAll(identity), identity.accountId());
    if (rows.size() != 1) { throw new IllegalArgumentException("属性模板版本不可用或与商品分类不符"); }
    Binding binding = rows.getFirst();
    if (!Objects.equals(binding.revision(), revision)) { throw new IllegalArgumentException("属性模板已更新，请刷新后重试"); }
    return binding;
  }

  static void requireBinding(Long requestedId, Integer requestedRevision, Long storedId, Integer storedRevision, JsonNode snapshot) {
    if (storedId == null || storedRevision == null || snapshot == null || !snapshot.isArray()) {
      throw new IllegalArgumentException("商品属性版本尚未绑定，请核对后重试");
    }
    if (requestedId != null && !Objects.equals(requestedId, storedId)
        || requestedRevision != null && !Objects.equals(requestedRevision, storedRevision)) {
      throw new IllegalArgumentException("编辑商品不能切换属性模板版本");
    }
  }

  public static Map<String, String> names(JsonNode snapshot) {
    Map<String, String> names = new LinkedHashMap<>();
    if (snapshot != null && snapshot.isArray()) {
      snapshot.forEach(field -> names.put("attribute_" + field.path("attributeId").asLong(), field.path("name").asText()));
    }
    return names;
  }

  public static Map<String, String> usedNames(JsonNode snapshot, JsonNode variants) {
    var definitions = names(snapshot);
    Map<String, String> used = new LinkedHashMap<>();
    variants.forEach(variant -> variant.path("salesAttributes").fieldNames().forEachRemaining(key -> {
      if (definitions.containsKey(key)) { used.put(key, definitions.get(key)); }
    }));
    return used;
  }

  Map<Long, String> unchangedProductAttributes(Object product, Object previous) {
    Map<Long, String> current = attributes(json.valueToTree(product));
    Map<Long, String> old = attributes(json.valueToTree(previous));
    Map<Long, String> unchanged = new LinkedHashMap<>();
    current.forEach((id, value) -> { if (old.containsKey(id) && Objects.equals(value, old.get(id))) { unchanged.put(id, value); } });
    return unchanged;
  }

  void validate(JsonNode snapshot, Object product, Object previous) {
    if (snapshot == null || !snapshot.isArray()) { throw new IllegalArgumentException("商品属性版本尚未绑定，请核对后重试"); }
    JsonNode current = json.valueToTree(product);
    JsonNode old = previous == null ? null : json.valueToTree(previous);
    Map<Long, JsonNode> definitions = new LinkedHashMap<>();
    snapshot.forEach(field -> definitions.put(field.path("attributeId").asLong(), field));
    for (String role : java.util.List.of("product", "sales")) {
      var seen = new LinkedHashSet<String>();
      for (JsonNode key : current.path("attributeDisplayOrder").path(role)) {
        String value = key.asText();
        String id = "sales".equals(role) && value.startsWith("attribute_") ? value.substring(10) : value;
        if (!id.matches("[0-9]{1,18}") || !String.valueOf(Long.valueOf(id)).equals(id) || !seen.add(value)) { throw new IllegalArgumentException("属性显示顺序不正确"); }
        requireRole(definitions, Long.valueOf(id), role);
      }
    }
    Map<Long, String> values = attributes(current);
    Map<Long, String> oldValues = attributes(old);
    for (Long id : values.keySet()) { requireRole(definitions, id, "product"); }
    for (JsonNode field : snapshot) {
      if ("product".equals(field.path("attributeRole").asText())) {
        long id = field.path("attributeId").asLong();
        check(field, values.get(id), old != null && values.containsKey(id) == oldValues.containsKey(id)
            && Objects.equals(values.get(id), oldValues.get(id)));
      }
    }
    Map<Long, JsonNode> oldVariants = new LinkedHashMap<>();
    if (old != null) { old.path("variants").forEach(v -> oldVariants.put(v.path("id").asLong(), v)); }
    for (JsonNode variant : current.path("variants")) {
      JsonNode before = variant.hasNonNull("id") ? oldVariants.get(variant.path("id").asLong()) : null;
      JsonNode sales = variant.path("salesAttributes");
      sales.fieldNames().forEachRemaining(key -> {
        if (key.matches("attribute_[1-9][0-9]{0,17}")) { requireRole(definitions, Long.valueOf(key.substring(10)), "sales"); }
        else { throw new IllegalArgumentException("销售属性不属于商品绑定版本"); }
      });
      for (JsonNode field : snapshot) {
        if (!"sales".equals(field.path("attributeRole").asText())) { continue; }
        String key = "attribute_" + field.path("attributeId").asLong();
        String value = text(sales.get(key));
        JsonNode oldSales = before == null ? null : before.path("salesAttributes");
        boolean unchanged = oldSales != null && sales.has(key) == oldSales.has(key)
            && Objects.equals(value, text(oldSales.get(key)));
        check(field, value, unchanged);
      }
    }
    for (JsonNode dimension : current.path("specDimensions")) {
      String key = dimension.path("key").asText();
      if (key.matches("attribute_[1-9][0-9]{0,17}")) { requireRole(definitions, Long.valueOf(key.substring(10)), "sales"); }
    }
  }

  private static JsonNode requireRole(Map<Long, JsonNode> definitions, Long id, String role) {
    JsonNode field = definitions.get(id);
    if (field == null || !role.equals(field.path("attributeRole").asText())) {
      throw new IllegalArgumentException("属性不属于商品绑定版本或属性角色不符");
    }
    return field;
  }

  private static Map<Long, String> attributes(JsonNode product) {
    Map<Long, String> result = new LinkedHashMap<>();
    if (product != null) {
      for (JsonNode entry : product.path("attributes")) {
        long id = entry.path("attributeId").asLong();
        if (result.containsKey(id)) { throw new IllegalArgumentException("商品属性不能重复"); }
        result.put(id, text(entry.get("value")));
      }
    }
    return result;
  }

  private static String text(JsonNode value) { return value == null || value.isNull() ? null : value.asText(); }

  private static void check(JsonNode field, String value, boolean unchanged) {
    if (unchanged) { return; } // Only the same stored product/SKU value receives legacy compatibility.
    String name = field.path("name").asText();
    if (value == null || value.isBlank()) {
      if (field.path("requiredFlag").asBoolean()) { throw new IllegalArgumentException("请填写" + name); }
      return;
    }
    if ("number".equals(field.path("valueType").asText())) {
      try {
        if (new BigDecimal(value.trim()).scale() > 2) { throw new IllegalArgumentException(name + "最多输入两位小数"); }
      } catch (NumberFormatException e) { throw new IllegalArgumentException(name + "请输入数字", e); }
    }
    if ("select".equals(field.path("valueType").asText())) {
      var options = new LinkedHashSet<String>();
      field.path("options").forEach(option -> options.add(option.path("value").asText()));
      if (!options.contains(value)) { throw new IllegalArgumentException(name + "请选择绑定版本中的有效选项"); }
    }
  }
}
