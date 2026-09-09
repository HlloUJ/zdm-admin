package com.zdm.platform.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.security.TokenAuthenticationFilter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
@Transactional
class TemplateVersionApiTest {
  @Container
  private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("zdm_template_version_test");
  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper json;
  @Autowired private JdbcTemplate jdbc;

  @DynamicPropertySource
  static void datasource(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
  }

  private JsonNode ok(MockHttpServletRequestBuilder request) throws Exception {
    return json.readTree(mvc.perform(auth(request)).andExpect(status().isOk()).andReturn()
        .getResponse().getContentAsString()).path("data");
  }
  private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
    return request.header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
        .contentType("application/json");
  }
  private long category(String scope) {
    String name = "模板版本测试-" + System.nanoTime();
    jdbc.update("INSERT INTO product_categories(scope, name, status) VALUES(?, ?, 'enabled')", scope, name);
    return jdbc.queryForObject("SELECT id FROM product_categories WHERE name = ?", Long.class, name);
  }
  private long attribute(String scope) {
    String name = "版本属性-" + System.nanoTime();
    jdbc.update("INSERT INTO product_attributes(scope, name, value_type, status) VALUES(?, ?, 'text', 'enabled')", scope, name);
    return jdbc.queryForObject("SELECT id FROM product_attributes WHERE name = ?", Long.class, name);
  }
  private JsonNode draft(long category) throws Exception {
    return ok(post("/api/admin/template-versions").content("{\"categoryId\":" + category + "}"));
  }
  private JsonNode save(JsonNode version, String content) throws Exception {
    return ok(put("/api/admin/template-versions/" + version.path("id").asLong())
        .content("{\"revision\":" + version.path("revision").asInt() + ",\"content\":" + content + ",\"changeNote\":\"测试变更\"}"));
  }
  private JsonNode publish(JsonNode version) throws Exception {
    return ok(post("/api/admin/template-versions/" + version.path("id").asLong() + "/publish")
        .content("{\"revision\":" + version.path("revision").asInt() + "}"));
  }
  private String rows(long id, String role) {
    return "[{\"attributeId\":" + id + ",\"attributeRole\":\"" + role + "\",\"requiredFlag\":true,\"options\":[]}]";
  }

  @Test
  void copyPreservesSnapshotAndProtectsExistingDraftRevision() throws Exception {
    long category = category("finished");
    long attribute = attribute("shared");
    JsonNode original = publish(save(draft(category), rows(attribute, "sales")));
    long source = original.path("id").asLong();
    String endpoint = "/api/admin/template-versions/" + source + "/copy";
    JsonNode copied = ok(post(endpoint).content("{}"));
    assertThat(copied.path("state").asText()).isEqualTo("draft");
    assertThat(copied.path("versionNo").isNull()).isTrue();
    assertThat(copied.path("content")).isEqualTo(original.path("content"));
    JsonNode edited = save(copied, rows(attribute, "product"));
    mvc.perform(auth(post(endpoint).content("{}"))).andExpect(status().isBadRequest());
    String stale = json.createObjectNode().put("draftId", copied.path("id").asLong())
        .put("revision", copied.path("revision").asInt()).toString();
    mvc.perform(auth(post(endpoint).content(stale))).andExpect(status().isBadRequest());
    assertThat(ok(get("/api/admin/template-versions/" + copied.path("id").asLong())).path("content"))
        .isEqualTo(edited.path("content"));
    String confirmed = json.createObjectNode().put("draftId", edited.path("id").asLong())
        .put("revision", edited.path("revision").asInt()).toString();
    JsonNode overwritten = ok(post(endpoint).content(confirmed));
    assertThat(overwritten.path("content")).isEqualTo(original.path("content"));
    JsonNode published = publish(save(overwritten, rows(attribute, "product")));
    assertThat(published.path("versionNo").asInt()).isEqualTo(2);
    assertThat(ok(get("/api/admin/template-versions/" + source))).isEqualTo(original);
    JsonNode historicalCopy = ok(post(endpoint).content("{}"));
    assertThat(historicalCopy.path("content")).isEqualTo(original.path("content"));
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM category_template_versions WHERE category_id = ? AND state = 'draft'",
        Integer.class, category)).isEqualTo(1);
  }

  @Test
  void versionSnapshotsDriveReferenceCountsAndDeletionProtection() throws Exception {
    long category = category("finished");
    long attribute = attribute("shared");
    jdbc.update("UPDATE product_attributes SET value_type = 'select' WHERE id = ?", attribute);
    jdbc.update("INSERT INTO product_attribute_values(attribute_id, scope, value, code, status) VALUES(?, 'shared', '模板选项', ?, 'enabled')", attribute, "version-ref-" + attribute);
    long value = jdbc.queryForObject("SELECT id FROM product_attribute_values WHERE attribute_id = ?", Long.class, attribute);
    String content = "[{\"attributeId\":" + attribute + ",\"attributeRole\":\"sales\",\"options\":[{\"id\":" + value + "}]}]";
    JsonNode published = publish(save(draft(category), content));
    save(draft(category), content);
    JsonNode attributes = ok(get("/api/admin/product-attributes"));
    JsonNode values = ok(get("/api/admin/product-attribute-values"));
    boolean foundAttribute = false;
    for (JsonNode row : attributes) {
      if (row.path("id").asLong() == attribute) {
        assertThat(row.path("templateCount").asInt()).isEqualTo(1);
        foundAttribute = true;
      }
    }
    assertThat(foundAttribute).isTrue();
    boolean foundValue = false;
    for (JsonNode row : values) {
      if (row.path("id").asLong() == value) {
        assertThat(row.path("useCount").asInt()).isEqualTo(1);
        foundValue = true;
      }
    }
    assertThat(foundValue).isTrue();
    mvc.perform(auth(delete("/api/admin/product-attributes/" + attribute))).andExpect(status().isBadRequest());
    mvc.perform(auth(delete("/api/admin/product-categories/" + category))).andExpect(status().isBadRequest());
    assertThat(ok(get("/api/admin/template-versions/" + published.path("id").asLong()))).isEqualTo(published);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('category_attributes', 'category_attribute_value_bindings')", Integer.class)).isZero();
  }

  @Test
  void specificationFlagsPersistAndOnlyFourSalesAttributesCanBeEnabled() throws Exception {
    JsonNode draft = draft(category("finished"));
    var content = json.createArrayNode();
    for (int index = 0; index < 5; index++) {
      content.addObject().put("attributeId", attribute("shared")).put("attributeRole", "sales")
          .put("skuFlag", index < 4).putArray("options");
    }
    draft = save(draft, content.toString());
    long id = draft.path("id").asLong();
    assertThat(ok(get("/api/admin/template-versions/" + id)).path("content").get(0).path("skuFlag").asBoolean()).isTrue();
    ((com.fasterxml.jackson.databind.node.ObjectNode) content.get(4)).put("skuFlag", true);
    mvc.perform(auth(put("/api/admin/template-versions/" + id))
        .content("{\"revision\":" + draft.path("revision").asInt() + ",\"content\":" + content + "}"))
        .andExpect(status().isBadRequest())
        .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.message").value("最多选择4个属性构建规格"));
    ((com.fasterxml.jackson.databind.node.ObjectNode) content.get(4)).put("skuFlag", false);
    ((com.fasterxml.jackson.databind.node.ObjectNode) content.get(0)).put("attributeRole", "product");
    mvc.perform(auth(put("/api/admin/template-versions/" + id))
        .content("{\"revision\":" + draft.path("revision").asInt() + ",\"content\":" + content + "}"))
        .andExpect(status().isBadRequest());
    ((com.fasterxml.jackson.databind.node.ObjectNode) content.get(0)).put("skuFlag", false);
    draft = save(draft, content.toString());
    JsonNode published = publish(draft);
    assertThat(published.path("content").get(0).path("skuFlag").asBoolean()).isFalse();
    assertThat(published.path("content").get(1).path("skuFlag").asBoolean()).isTrue();
    assertThat(ok(get("/api/admin/template-versions/" + id)).path("content")).isEqualTo(published.path("content"));
  }

  @Test
  void retiredSpecificationSchemaAndCreationAreUnavailable() throws Exception {
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'category_template_versions' AND column_name IN ('kind', 'attribute_version_id', 'base_version_id', 'draft_kind')", Integer.class)).isZero();
    long category = category("finished");
    mvc.perform(auth(post("/api/admin/template-versions"))
        .content("{\"categoryId\":" + category + ",\"kind\":\"sku\"}"))
        .andExpect(status().isBadRequest());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM category_template_versions WHERE category_id = ?", Integer.class, category)).isZero();
    JsonNode draft = draft(category);
    assertThat(draft.has("kind")).isFalse();
    assertThat(draft.has("attributeVersionId")).isFalse();
  }

  @Test
  void publishedFieldOrderCanChangeWithoutChangingBusinessConfiguration() throws Exception {
    long category = category("finished");
    long first = attribute("shared");
    long second = attribute("shared");
    String firstRow = rows(first, "sales");
    String content = firstRow.substring(0, firstRow.length() - 1) + "," + rows(second, "product").substring(1);
    JsonNode published = publish(save(draft(category), content));
    long id = published.path("id").asLong();
    String order = "{\"revision\":" + published.path("revision").asInt()
        + ",\"attributeIds\":[" + second + "," + first + "]}";
    JsonNode reordered = ok(put("/api/admin/template-versions/" + id + "/display-order").content(order));
    assertThat(reordered.path("versionNo")).isEqualTo(published.path("versionNo"));
    assertThat(reordered.path("publishedAt")).isEqualTo(published.path("publishedAt"));
    assertThat(reordered.path("publishedByName")).isEqualTo(published.path("publishedByName"));
    assertThat(reordered.path("content").get(0).path("attributeId").asLong()).isEqualTo(second);
    for (JsonNode row : reordered.path("content")) {
      JsonNode original = published.path("content").get(row.path("attributeId").asLong() == first ? 0 : 1);
      var actual = (com.fasterxml.jackson.databind.node.ObjectNode) row.deepCopy();
      var expected = (com.fasterxml.jackson.databind.node.ObjectNode) original.deepCopy();
      actual.remove("sortOrder");
      expected.remove("sortOrder");
      assertThat(actual).isEqualTo(expected);
    }
    assertThat(ok(get("/api/admin/template-versions/" + id)).path("content")).isEqualTo(reordered.path("content"));
    mvc.perform(auth(put("/api/admin/template-versions/" + id + "/display-order")).content(order))
        .andExpect(status().isBadRequest());
    int revision = reordered.path("revision").asInt();
    for (String ids : List.of("[" + first + "]", "[" + first + "," + first + "]", "[" + first + ",99999999]")) {
      mvc.perform(auth(put("/api/admin/template-versions/" + id + "/display-order"))
          .content("{\"revision\":" + revision + ",\"attributeIds\":" + ids + "}"))
          .andExpect(status().isBadRequest());
    }
    mvc.perform(auth(put("/api/admin/template-versions/" + id)).content("{\"revision\":" + revision + ",\"content\":[]}"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void timestampsKeepDatabaseBeijingTimeWithExplicitOffset() throws Exception {
    JsonNode version = draft(category("finished"));
    long id = version.path("id").asLong();
    jdbc.update("UPDATE category_template_versions SET created_at = '2026-09-09 10:38:35', published_at = '2026-09-09 10:59:39' WHERE id = ?", id);
    JsonNode result = ok(get("/api/admin/template-versions/" + id));
    assertThat(result.path("createdAt").asText()).isEqualTo("2026-09-09T10:38:35+08:00");
    assertThat(result.path("publishedAt").asText()).isEqualTo("2026-09-09T10:59:39+08:00");
  }

  @Test
  void snapshotsAreImmutableAndVersionsIncreaseOnPublication() throws Exception {
    long category = category("finished");
    long attribute = attribute("shared");
    JsonNode draft = draft(category);
    assertThat(draft.path("versionNo").isNull()).isTrue();
    draft = save(draft, rows(attribute, "sales"));
    assertThat(draft.path("versionNo").isNull()).isTrue();
    JsonNode v1 = publish(draft);
    assertThat(v1.path("versionNo").asInt()).isEqualTo(1);
    long id = v1.path("id").asLong();
    mvc.perform(auth(put("/api/admin/template-versions/" + id)).content("{\"revision\":2,\"content\":[]}"))
        .andExpect(status().isBadRequest());
    mvc.perform(auth(delete("/api/admin/template-versions/" + id + "?revision=2"))).andExpect(status().isBadRequest());
    jdbc.update("UPDATE product_attributes SET name = '新名称' WHERE id = ?", attribute);
    assertThat(ok(get("/api/admin/template-versions/" + id)).path("content")).isEqualTo(v1.path("content"));
    JsonNode v2 = publish(save(draft(category), rows(attribute, "product")));
    assertThat(v2.path("versionNo").asInt()).isEqualTo(2);
  }

  @Test
  void rejectsStaleWritesDuplicateDraftsAndCrossScopeBindings() throws Exception {
    long category = category("finished");
    JsonNode draft = draft(category);
    mvc.perform(auth(post("/api/admin/template-versions")).content("{\"categoryId\":" + category + "}"))
        .andExpect(status().isBadRequest());
    save(draft, "[]");
    mvc.perform(auth(put("/api/admin/template-versions/" + draft.path("id").asLong())).content("{\"revision\":0,\"content\":[]}"))
        .andExpect(status().isBadRequest());
    mvc.perform(auth(put("/api/admin/template-versions/" + draft.path("id").asLong()))
        .content("{\"revision\":1,\"content\":" + rows(attribute("accessory"), "sales") + "}"))
        .andExpect(status().isBadRequest());
    mvc.perform(auth(post("/api/admin/template-versions/" + draft.path("id").asLong() + "/publish"))
        .content("{\"revision\":1}")).andExpect(status().isBadRequest());

  }
}
