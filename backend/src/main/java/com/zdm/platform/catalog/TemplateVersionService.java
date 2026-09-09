package com.zdm.platform.catalog;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zdm.platform.security.PermissionGuard;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TemplateVersionService {
  private static final String PREFIX = "admin.product-data-center.category-attribute-template.";
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final PermissionGuard guard;
  private final ProductCategoryService categories;
  private final ProductAttributeService attributes;
  private final ProductAttributeValueService values;

  public TemplateVersionService(JdbcTemplate jdbc, ObjectMapper json, PermissionGuard guard,
      ProductCategoryService categories, ProductAttributeService attributes, ProductAttributeValueService values) {
    this.jdbc = jdbc;
    this.json = json;
    this.guard = guard;
    this.categories = categories;
    this.attributes = attributes;
    this.values = values;
  }

  private ProductCategory authorize(long categoryId, String action) {
    ProductCategory category = categories.getById(categoryId);
    if (category == null || category.getTenantId() != null
        || !Set.of("finished", "accessory").contains(category.getScope())) {
      throw new AccessDeniedException("无权访问该分类模板");
    }
    guard.requirePermission(PREFIX + category.getScope() + ".attributes." + action);
    if (!Set.of("view", "history").contains(action) && (!"admin".equals(guard.identity().clientCode())
        || guard.identity().tenantId() != null || guard.identity().storeId() != null)) {
      throw new AccessDeniedException("仅平台身份可以维护公共分类模板");
    }
    return category;
  }

  public List<ProductCategory> categoryOptions(String scope) {
    if (!Set.of("finished", "accessory").contains(scope)) {
      throw new IllegalArgumentException("模板范围无效");
    }
    guard.requirePermission(PREFIX + scope + ".attributes.view");
    return categories.lambdaQuery().eq(ProductCategory::getScope, scope)
        .isNull(ProductCategory::getTenantId).orderByAsc(ProductCategory::getSortOrder).list();
  }

  public List<ProductAttribute> attributeOptions(long categoryId) {
    ProductCategory category = authorize(categoryId, "view");
    return attributes.lambdaQuery().in(ProductAttribute::getScope, List.of("shared", category.getScope()))
        .isNull(ProductAttribute::getDeletedAt).eq(ProductAttribute::getStatus, "enabled").list();
  }

  public List<ProductAttributeValue> valueOptions(long categoryId, long attributeId) {
    ProductCategory category = authorize(categoryId, "view");
    ProductAttribute attribute = attributes.getActiveByIdForShare(attributeId);
    if (attribute == null || !Set.of("shared", category.getScope()).contains(attribute.getScope())) {
      throw new IllegalArgumentException("属性不属于当前模板范围");
    }
    return values.lambdaQuery().eq(ProductAttributeValue::getAttributeId, attributeId)
        .eq(ProductAttributeValue::getStatus, "enabled").list();
  }

  private JsonNode sortedContent(JsonNode content) {
    List<JsonNode> rows = new ArrayList<>();
    content.forEach(rows::add);
    rows.sort(Comparator.comparingInt(row -> row.path("sortOrder").asInt()));
    ArrayNode result = json.createArrayNode();
    rows.forEach(result::add);
    return result;
  }

  public List<TemplateVersion> list(long categoryId) {
    ProductCategory category = authorize(categoryId, "view");
    List<TemplateVersion> versions = jdbc.query("SELECT * FROM category_template_versions WHERE category_id = ? ORDER BY state ASC, version_no DESC",
        this::map, categoryId);
    String prefix = PREFIX + category.getScope() + ".attributes.";
    int latest = versions.stream().filter(v -> "published".equals(v.state()))
        .mapToInt(TemplateVersion::versionNo).max().orElse(0);
    return versions.stream().filter(v -> "draft".equals(v.state())
        ? guard.hasPermission(prefix + "create")
        : v.versionNo() == latest || guard.hasPermission(prefix + "history")).toList();
  }

  public TemplateVersion get(long id) {
    TemplateVersion version = require(id, false);
    authorize(version.categoryId(), "view");
    if ("draft".equals(version.state())) {
      authorize(version.categoryId(), "create");
    } else {
      Integer latest = jdbc.queryForObject("SELECT MAX(version_no) FROM category_template_versions WHERE category_id = ? AND state = 'published'",
          Integer.class, version.categoryId());
      if (!java.util.Objects.equals(version.versionNo(), latest)) {
        authorize(version.categoryId(), "history");
      }
    }
    return version;
  }

  @Transactional
  public TemplateVersion create(long categoryId) {
    ProductCategory category = authorize(categoryId, "create");
    if (!"enabled".equals(category.getStatus())) {
      throw new IllegalArgumentException("分类已停用，不能创建草稿");
    }
    // Lock the category to serialize numbering and one-draft-per-category creation.
    jdbc.queryForObject("SELECT id FROM product_categories WHERE id = ? FOR UPDATE", Long.class, categoryId);
    if (java.util.Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM category_template_versions WHERE category_id = ? AND state = 'draft'",
        Long.class, categoryId)) > 0) {
      throw new IllegalArgumentException("已有未发布草稿，请先处理现有草稿");
    }
    if (java.util.Objects.requireNonNull(jdbc.queryForObject("SELECT COUNT(*) FROM product_categories WHERE parent_id = ?", Long.class, categoryId)) > 0) {
      throw new IllegalArgumentException("请选择末级分类维护模板");
    }
    JsonNode content = json.createArrayNode();
    jdbc.update("INSERT INTO category_template_versions(category_id, content, created_by_name, created_by_account_id) VALUES(?, ?, ?, ?)",
        categoryId, content.toString(), guard.identity().displayName(), guard.identity().accountId());
    return jdbc.queryForObject("SELECT * FROM category_template_versions WHERE category_id = ? AND state = 'draft'",
        this::map, categoryId);
  }

  @Transactional
  public TemplateVersion copy(long sourceId, Long draftId, Integer revision) {
    TemplateVersion source = get(sourceId);
    authorize(source.categoryId(), "create");
    if (!"published".equals(source.state())) {
      throw new IllegalArgumentException("仅已发布版本可以复制");
    }
    ProductCategory category = categories.getById(source.categoryId());
    if (!"enabled".equals(category.getStatus())) {
      throw new IllegalArgumentException("分类已停用，不能复制草稿");
    }
    jdbc.queryForObject("SELECT id FROM product_categories WHERE id = ? FOR UPDATE", Long.class, source.categoryId());
    List<TemplateVersion> drafts = jdbc.query("SELECT * FROM category_template_versions WHERE category_id = ? AND state = 'draft' FOR UPDATE",
        this::map, source.categoryId());
    TemplateVersion target;
    if (drafts.isEmpty()) {
      if (draftId != null || revision != null) {
        throw new IllegalArgumentException("草稿状态已变化，请刷新后重试");
      }
      target = create(source.categoryId());
    } else {
      target = drafts.get(0);
      if (!java.util.Objects.equals(draftId, target.id())
          || !java.util.Objects.equals(revision, target.revision())) {
        throw new IllegalArgumentException("已有草稿或草稿已更新，请刷新并确认覆盖后重试");
      }
    }
    jdbc.update("UPDATE category_template_versions SET content = ?, change_note = ?, revision = revision + 1 WHERE id = ?",
        source.content().toString(), source.changeNote(), target.id());
    return require(target.id(), false);
  }

  @Transactional
  public TemplateVersion save(long id, TemplateVersionRequest request) {
    TemplateVersion version = writable(id, "create", request.revision());
    ArrayNode content = normalizeAttributes(version, request.content(), false);
    jdbc.update("UPDATE category_template_versions SET content = ?, change_note = ?, revision = revision + 1 WHERE id = ?", content.toString(), request.changeNote() == null ? "" : request.changeNote().trim(), id);
    return require(id, false);
  }

  @Transactional
  public TemplateVersion publish(long id, int revision) {
    TemplateVersion version = writable(id, "create", revision);
    ProductCategory category = categories.getById(version.categoryId());
    if (!"enabled".equals(category.getStatus())) {
      throw new IllegalArgumentException("分类已停用，不能发布");
    }
    ArrayNode content = normalizeAttributes(version, version.content(), true);
    jdbc.queryForObject("SELECT id FROM product_categories WHERE id = ? FOR UPDATE", Long.class, version.categoryId());
    List<TemplateVersion> published = jdbc.query("SELECT * FROM category_template_versions WHERE category_id = ? AND state = 'published' ORDER BY version_no DESC LIMIT 1",
        this::map, version.categoryId());
    if (!published.isEmpty() && published.get(0).content().equals(content)) {
      throw new IllegalArgumentException("配置未变化，无需发布新版本");
    }
    int number = published.isEmpty() ? 1 : published.get(0).versionNo() + 1;
    jdbc.update("UPDATE category_template_versions SET content = ?, version_no = ?, state = 'published', published_at = CURRENT_TIMESTAMP, published_by_name = ?, revision = revision + 1 WHERE id = ?",
        content.toString(), number, guard.identity().displayName(), id);
    return require(id, false);
  }

  @Transactional
  public TemplateVersion reorder(long id, int revision, List<Long> attributeIds) {
    TemplateVersion version = require(id, true);
    authorize(version.categoryId(), "create");
    if (!"published".equals(version.state())) {
      throw new IllegalArgumentException("仅已发布属性模板支持调整显示顺序");
    }
    if (version.revision() != revision) {
      throw new IllegalArgumentException("显示顺序已被其他操作更新，请刷新后重试");
    }
    var byId = new java.util.HashMap<Long, JsonNode>();
    version.content().forEach(row -> byId.put(row.path("attributeId").asLong(), row));
    if (attributeIds == null || attributeIds.size() != byId.size()
        || !new HashSet<>(attributeIds).equals(byId.keySet())) {
      throw new IllegalArgumentException("显示顺序必须包含且仅包含当前版本的全部属性");
    }
    ArrayNode reordered = json.createArrayNode();
    for (Long attributeId : attributeIds) {
      ObjectNode row = byId.get(attributeId).deepCopy();
      row.put("sortOrder", reordered.size() + 1);
      reordered.add(row);
    }
    // Only display order is mutable after publication; every other snapshot field stays intact.
    jdbc.update("UPDATE category_template_versions SET content = ?, revision = revision + 1 WHERE id = ?",
        reordered.toString(), id);
    return require(id, false);
  }

  @Transactional
  public void discard(long id, int revision) {
    writable(id, "create", revision);
    jdbc.update("DELETE FROM category_template_versions WHERE id = ?", id);
  }

  private TemplateVersion writable(long id, String action, int revision) {
    TemplateVersion version = require(id, true);
    authorize(version.categoryId(), action);
    if (!"draft".equals(version.state())) {
      throw new IllegalArgumentException("已发布版本不可修改，请创建新版本草稿");
    }
    if (version.revision() != revision) {
      throw new IllegalArgumentException("草稿已被其他操作更新，请刷新后重试");
    }
    return version;
  }

  private ArrayNode normalizeAttributes(TemplateVersion version, JsonNode source, boolean publishing) {
    if (!source.isArray() || source.size() > 200) {
      throw new IllegalArgumentException("属性列表无效，最多200项");
    }
    if (publishing && source.isEmpty()) {
      throw new IllegalArgumentException("请先绑定属性");
    }
    Set<Long> ids = new HashSet<>();
    int specificationCount = 0;
    ArrayNode result = json.createArrayNode();
    ProductCategory category = categories.getById(version.categoryId());
    for (JsonNode item : source) {
      long id = item.path("attributeId").asLong();
      if (!ids.add(id)) {
        throw new IllegalArgumentException("不能重复绑定属性");
      }
      ProductAttribute attribute = attributes.getActiveByIdForShare(id);
      if (attribute == null || !"enabled".equals(attribute.getStatus())
          || !("shared".equals(attribute.getScope()) || category.getScope().equals(attribute.getScope()))) {
        throw new IllegalArgumentException("只能绑定当前范围内未停用、未删除的属性");
      }
      String role = item.path("attributeRole").asText("");
      if (!role.isEmpty() && !Set.of("product", "sales").contains(role)) {
        throw new IllegalArgumentException("属性角色无效");
      }
      if (publishing && role.isEmpty()) {
        throw new IllegalArgumentException("请选择“" + attribute.getName() + "”的属性角色");
      }
      boolean skuFlag = item.path("skuFlag").asBoolean(false);
      if (skuFlag && !"sales".equals(role)) {
        throw new IllegalArgumentException("只有销售属性才能构建规格");
      }
      if (skuFlag && ++specificationCount > 4) {
        throw new IllegalArgumentException("最多选择4个属性构建规格");
      }
      ObjectNode row = json.createObjectNode();
      row.put("attributeId", id).put("name", attribute.getName()).put("scope", attribute.getScope())
          .put("valueType", attribute.getValueType()).put("attributeRole", role)
          .put("requiredFlag", item.path("requiredFlag").asBoolean()).put("skuFlag", skuFlag).put("sortOrder", result.size() + 1);
      ArrayNode options = row.putArray("options");
      Set<Long> valueIds = new HashSet<>();
      if ("select".equals(attribute.getValueType())) {
        JsonNode selected = item.path("options");
        if (!selected.isMissingNode() && (!selected.isArray() || selected.size() > 1000)) {
          throw new IllegalArgumentException("选项值列表无效");
        }
        for (JsonNode option : selected) {
          long valueId = option.path("id").asLong();
          ProductAttributeValue value = values.getById(valueId);
          if (!valueIds.add(valueId) || value == null || value.getAttributeId() != id || !"enabled".equals(value.getStatus())) {
            throw new IllegalArgumentException("只能绑定该属性下已启用的选项值");
          }
          options.addObject().put("id", valueId).put("value", value.getValue()).put("code", value.getCode());
        }
        if (publishing && options.isEmpty()) {
          throw new IllegalArgumentException("请为“" + attribute.getName() + "”绑定选项值");
        }
      }
      result.add(row);
    }
    return result;
  }

  private TemplateVersion require(long id, boolean lock) {
    List<TemplateVersion> rows = jdbc.query("SELECT * FROM category_template_versions WHERE id = ?" + (lock ? " FOR UPDATE" : ""), this::map, id);
    if (rows.isEmpty()) {
      throw new IllegalArgumentException("模板版本不存在");
    }
    return rows.get(0);
  }

  private TemplateVersion map(ResultSet row, int index) throws SQLException {
    try {
      long id = row.getLong("id");
      var published = row.getObject("published_at", LocalDateTime.class);
      return new TemplateVersion(id, row.getLong("category_id"),
          row.getObject("version_no", Integer.class), row.getString("state"), row.getInt("revision"), sortedContent( json.readTree(row.getString("content"))),
          row.getString("created_by_name"), row.getString("published_by_name"), row.getString("change_note"), row.getObject("created_at", LocalDateTime.class).atOffset(ZoneOffset.ofHours(8)),
          published == null ? null : published.atOffset(ZoneOffset.ofHours(8)));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("模板快照格式错误", e);
    }
  }
}
