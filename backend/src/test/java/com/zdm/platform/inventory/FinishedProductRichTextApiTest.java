package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zdm.platform.security.TokenAuthenticationFilter;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class FinishedProductRichTextApiTest {
  @Container
  private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("zdm_finished_rich_test").withUsername("zdm_admin").withPassword("zdm_admin_pwd");
  @Autowired private MockMvc mvc;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ObjectMapper json;
  private final String token = "Bearer " + TokenAuthenticationFilter.createAccountToken(1L);

  @DynamicPropertySource
  static void datasource(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
    registry.add("zdm.media.storage-path", () -> System.getProperty("java.io.tmpdir") + "/zdm-finished-rich-test");
  }

  @Test
  void productTemplateOptionsUseLatestPublishedSnapshotOnly() throws Exception {
    jdbc.update("INSERT INTO product_categories (id, scope, name) VALUES (99021, 'finished', '快照分类'), (99022, 'accessory', '配件分类')");
    String snapshot = "[{\"attributeId\":91,\"name\":\"发布名称\",\"attributeRole\":\"sales\",\"skuFlag\":true,\"requiredFlag\":true,\"sortOrder\":1,\"valueType\":\"select\",\"options\":[{\"id\":92,\"value\":\"发布值\"}]}]";
    jdbc.update("INSERT INTO category_template_versions (category_id, version_no, state, content, created_by_name) VALUES (99021, 1, 'published', '[]', '测试'), (99021, 2, 'published', ?, '测试'), (99021, NULL, 'draft', '[]', '测试'), (99022, 1, 'published', '[]', '测试')", snapshot);
    JsonNode result = data(mvc.perform(get("/api/admin/finished-products/attribute-template-options").header("Authorization", token)));
    List<JsonNode> matching = new ArrayList<>();
    result.forEach(row -> {
      assertThat(row.path("categoryId").asLong()).isNotEqualTo(99022L);
      if (row.path("categoryId").asLong() == 99021L) matching.add(row);
    });
    assertThat(matching).hasSize(1);
    assertThat(matching.getFirst().path("versionNo").asInt()).isEqualTo(2);
    assertThat(matching.getFirst().path("content")).isEqualTo(json.readTree(snapshot));
  }

  @Test
  void roundTripsRichTextAndGalleryAndReleasesRemovedReferences() throws Exception {
    jdbc.update("INSERT INTO product_categories (id,scope,name) VALUES (99007,'finished','一级类目')");
    jdbc.update("INSERT INTO product_categories (id,scope,name,parent_id) VALUES (99008,'finished','二级类目',99007),(99001,'finished','富文本验收分类',99008)");
    jdbc.update("""
        INSERT INTO suppliers (id, owner_scope, owner_id, name)
        VALUES (99001, 'platform', 0, '富文本验收供应商')
        """);
    jdbc.update("INSERT INTO supplier_supply_type_links (supplier_id, supply_type_id) VALUES (99001, 2)");
    jdbc.update("UPDATE store_levels SET status = 'disabled'");
    jdbc.update("INSERT INTO product_attributes (id,scope,name,value_type,attribute_role) VALUES (99001,'finished','历史材质','text','sales'),(99002,'finished','历史尺寸','text','sales')");
    List<JsonNode> images = new ArrayList<>();
    for (int i = 0; i < 6; i++) images.add(upload("image/png", "image.png"));
    JsonNode video = upload("video/webm", "video.webm");
    ObjectNode payload = (ObjectNode) json.readTree("""
        {"categoryId":99001,"supplierId":99001,"name":"富文本验收","sku":"rich-test",
         "status":"warehouse","attributes":[],
         "variants":[{"variantKey":"one","variantLabel":"规格","displayMode":"single","salesAttributes":{"attribute_99001":"胡桃木","attribute_99002":"大号"},"stock":0}],
         "guidePrices":[{"variantKey":"one","priceCoefficient":1,"costPrice":1,"price":1}]}
        """);
    payload.put("mainImageMediaId", images.getFirst().path("id").asLong());
    payload.set("mainImageMediaIds", json.valueToTree(images.subList(0, 5).stream().map(i -> i.path("id").asLong()).toList()));
    payload.put("videoMediaId", video.path("id").asLong());
    payload.put("detail", """
        <h2><strong>详情标题</strong></h2><p><span style="font-family:Arial;font-size:24px;color:red">材质</span>
        <a href="https://example.com">商品链接</a></p><img src="%s">
        <div data-w-e-type="video" data-w-e-is-void><video controls><source src="%s" type="video/mp4"></video></div>
        <table><tbody><tr><td>规格</td></tr></tbody></table>
        """.formatted(images.get(5).path("url").asText(), video.path("url").asText()));
    payload.put("sku", "   ");
    payload.put("createdByName", "伪造创建人");
    payload.put("createdByAccountId", 99999);
    payload.put("createdAt", "2000-01-01T00:00:00");
    LocalDateTime beforeCreate = LocalDateTime.now().minusSeconds(1);
    JsonNode created = data(mvc.perform(post("/api/admin/finished-products").header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    long id = created.path("id").asLong();
    assertThat(id).isPositive();
    Long createLogId = jdbc.queryForObject("SELECT id FROM finished_operation_logs WHERE product_id=? AND operation_type='CREATE'", Long.class, id);
    JsonNode createLog = data(mvc.perform(get("/api/admin/finished-products/operation-logs/{id}", createLogId).header("Authorization", token)));
    JsonNode snapshot = json.readTree(createLog.path("changeDetails").asText());
    assertThat(snapshot.path("商品名称").path("after").asText()).isEqualTo("富文本验收");
    assertThat(snapshot.path("商品分类").path("after").asText()).isEqualTo("一级类目 / 二级类目 / 富文本验收分类");
    assertThat(snapshot.path("销售规格").path("after").size()).isEqualTo(1);
    assertThat(snapshot.path("销售属性名称").path("after").path("attribute_99001").asText()).isEqualTo("历史材质");
    assertThat(snapshot.path("销售属性名称").path("after").path("attribute_99002").asText()).isEqualTo("历史尺寸");
    assertThat(snapshot.path("媒体").path("after").size()).isEqualTo(8);
    assertThat(createLog.path("operatorAccountId").asLong()).isEqualTo(1L);
    assertThat(createLog.path("operatorName").asText()).isNotEqualTo("伪造创建人");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE business_domain='FINISHED_PRODUCT_LOG' AND business_id=? AND reference_kind='HISTORY'", Integer.class, createLogId)).isEqualTo(8);
    data(mvc.perform(put("/api/admin/finished-products/{id}", id).header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=?", Integer.class, id)).isEqualTo(1);
    jdbc.update("INSERT INTO product_categories (id,scope,name) VALUES (99010,'finished','其他分类')");
    for (Long changedCategory : java.util.Arrays.asList(99010L, null)) {
      ObjectNode invalidCategory = payload.deepCopy();
      if (changedCategory == null) invalidCategory.putNull("categoryId");
      else invalidCategory.put("categoryId", changedCategory);
      mvc.perform(put("/api/admin/finished-products/{id}", id).header("Authorization", token)
          .contentType("application/json").content(json.writeValueAsBytes(invalidCategory)))
          .andExpect(status().isBadRequest());
      assertThat(jdbc.queryForObject("SELECT category_id FROM finished_products WHERE id=?", Long.class, id)).isEqualTo(99001L);
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=?", Integer.class, id)).isEqualTo(1);
    }
    mvc.perform(get("/api/admin/finished-products/operation-logs")).andExpect(status().isUnauthorized());
    jdbc.update("INSERT INTO store_levels (id,name,sort_order,status) VALUES (99009,'日志验证价格层级',1,'enabled')");
    jdbc.update("INSERT INTO finished_markup_configurations (id,name,store_level_id,price_coefficient,status,legacy_seeded,sort_order) VALUES (99009,'日志验证价格层级',99009,2,'enabled',false,1)");
    payload.set("markupPrices", json.readTree("[{\"variantKey\":\"one\",\"storeLevelId\":99009,\"costPrice\":1,\"priceCoefficient\":2,\"price\":2,\"priceSource\":\"auto\"}]"));
    data(mvc.perform(put("/api/admin/finished-products/{id}", id).header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    ((ObjectNode) payload.path("markupPrices").get(0)).put("priceSource", "manual");
    data(mvc.perform(put("/api/admin/finished-products/{id}", id).header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    String sourceChanges = jdbc.queryForObject("SELECT change_details FROM finished_operation_logs WHERE product_id=? AND operation_type='PRICE_UPDATE' ORDER BY id DESC LIMIT 1", String.class, id);
    JsonNode priceDiff = json.readTree(sourceChanges).path("层级价格");
    assertThat(priceDiff.path("before").get(0).path("priceSource").asText()).isEqualTo("auto");
    assertThat(priceDiff.path("after").get(0).path("priceSource").asText()).isEqualTo("manual");


    assertThat(created.path("sku").isNull()).isTrue();
    JsonNode second = data(mvc.perform(post("/api/admin/finished-products").header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    assertThat(second.path("sku").isNull()).isTrue();
    long secondId = second.path("id").asLong();
    payload.put("sku", "temporary-code");
    data(mvc.perform(put("/api/admin/finished-products/{id}", secondId).header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    payload.putNull("sku");
    JsonNode cleared = data(mvc.perform(put("/api/admin/finished-products/{id}", secondId).header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    assertThat(cleared.path("sku").isNull()).isTrue();
    assertThat(jdbc.queryForObject("SELECT sku FROM finished_products WHERE id = ?", String.class, secondId)).isNull();
    payload.put("status", "offShelf");
    payload.put("offShelfReason", "价格调整");
    payload.put("offShelfDetail", "供应商调整价格，待复核");
    LocalDateTime beforeOffShelf = LocalDateTime.now().minusSeconds(1);
    payload.put("offShelfAt", "2000-01-01T00:00:00");
    JsonNode offShelf = data(mvc.perform(put("/api/admin/finished-products/{id}", secondId).header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    assertThat(LocalDateTime.parse(offShelf.path("offShelfAt").asText())).isBetween(beforeOffShelf, LocalDateTime.now().plusSeconds(1));
    assertThat(offShelf.path("offShelfDetail").asText()).isEqualTo("供应商调整价格，待复核");
    assertThat(jdbc.queryForObject("SELECT off_shelf_detail FROM finished_products WHERE id=?", String.class, secondId))
        .isEqualTo("供应商调整价格，待复核");
    payload.put("offShelfDetail", "");
    JsonNode withoutDetail = data(mvc.perform(put("/api/admin/finished-products/{id}", secondId).header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    assertThat(withoutDetail.path("offShelfAt")).isEqualTo(offShelf.path("offShelfAt"));
    assertThat(withoutDetail.path("offShelfDetail").asText()).isEmpty();
    payload.put("status", "recycle");
    data(mvc.perform(put("/api/admin/finished-products/{id}", secondId).header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    data(mvc.perform(delete("/api/admin/finished-products/{id}", secondId).header("Authorization", token)));
    payload.put("status", "warehouse");
    assertThat(created.path("createdByAccountId").asLong()).isEqualTo(1L);
    assertThat(created.path("createdByName").asText()).isNotBlank().isNotEqualTo("伪造创建人");
    assertThat(LocalDateTime.parse(created.path("createdAt").asText()))
        .isBetween(beforeCreate, LocalDateTime.now().plusSeconds(1));
    String stored = jdbc.queryForObject("SELECT detail FROM finished_products WHERE id = ?", String.class, id);
    assertThat(stored).contains("media:" + images.get(5).path("id").asLong()).doesNotContain("/api/open/media/");
    JsonNode reloaded = data(mvc.perform(get("/api/admin/finished-products").header("Authorization", token))).get(0);
    assertThat(reloaded.path("variants").get(0).path("salesAttributes").path("attribute_99001").asText()).isEqualTo("胡桃木");
    assertThat(reloaded.path("variants").get(0).path("salesAttributes").path("attribute_99002").asText()).isEqualTo("大号");
    ((ObjectNode) payload.path("variants").get(0).path("salesAttributes")).put("attribute_99001", "橡木");
    assertThat(reloaded.path("mainImageMediaIds").toString()).isEqualTo(payload.path("mainImageMediaIds").toString());
    assertThat(reloaded.path("detail").asText()).contains("font-family:Arial", "font-size:24px", "<strong>",
        "https://example.com", "<table>", images.get(5).path("url").asText(), video.path("url").asText());
    assertThat(referenceCount(id, "detailMedia%")).isEqualTo(2);
    payload.put("detail", "<p><em>更新后的详情</em></p>");
    payload.put("status", "recycle");
    JsonNode updated = data(mvc.perform(put("/api/admin/finished-products/{id}", id).header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    assertThat(updated.path("createdByName")).isEqualTo(created.path("createdByName"));
    assertThat(updated.path("createdByAccountId")).isEqualTo(created.path("createdByAccountId"));
    assertThat(updated.path("createdAt")).isEqualTo(created.path("createdAt"));
    assertThat(updated.path("variants").get(0).path("salesAttributes").path("attribute_99001").asText()).isEqualTo("橡木");
    assertThat(updated.path("detail").asText()).contains("<em>更新后的详情</em>").doesNotContain("<img", "<video");
    assertThat(referenceCount(id, "detailMedia%")).isZero();
    assertThat(referenceCount(id, "%")).isEqualTo(6);
    data(mvc.perform(delete("/api/admin/finished-products/{id}", id).header("Authorization", token)));
    assertThat(referenceCount(id, "%")).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=? AND operation_type='PURGE'", Integer.class, id)).isEqualTo(1);
    JsonNode historical = data(mvc.perform(get("/api/admin/finished-products/operation-logs/{id}", createLogId).header("Authorization", token)));
    assertThat(historical.path("productName").asText()).isEqualTo("富文本验收");
    JsonNode page = data(mvc.perform(get("/api/admin/finished-products/operation-logs").param("keyword", "富文本验收").param("pageSize", "1").header("Authorization", token)));
    assertThat(page.path("records").size()).isEqualTo(1);
    assertThat(page.path("total").asInt()).isGreaterThan(1);
    jdbc.update("UPDATE product_categories SET name='调整后的一级类目' WHERE id=99007");
    JsonNode unchangedHistory = data(mvc.perform(get("/api/admin/finished-products/operation-logs/{id}", createLogId).header("Authorization", token)));
    assertThat(json.readTree(unchangedHistory.path("changeDetails").asText()).path("商品分类").path("after").asText()).isEqualTo("一级类目 / 二级类目 / 富文本验收分类");
    jdbc.update("UPDATE finished_operation_logs SET change_details=JSON_OBJECT('商品分类',JSON_OBJECT('before',NULL,'after','富文本验收分类')) WHERE id=?", createLogId);
    JsonNode legacy = data(mvc.perform(get("/api/admin/finished-products/operation-logs/{id}", createLogId).header("Authorization", token)));
    JsonNode legacyCategory = json.readTree(legacy.path("changeDetails").asText()).path("商品分类");
    assertThat(legacyCategory.path("after").asText()).isEqualTo("调整后的一级类目 / 二级类目 / 富文本验收分类");
    assertThat(legacyCategory.path("hint").asText()).contains("当前唯一匹配");
    jdbc.update("INSERT INTO product_categories (id,scope,name) VALUES (99006,'finished','富文本验收分类')");
    JsonNode ambiguous = data(mvc.perform(get("/api/admin/finished-products/operation-logs/{id}", createLogId).header("Authorization", token)));
    assertThat(json.readTree(ambiguous.path("changeDetails").asText()).path("商品分类").path("after").asText()).isEqualTo("富文本验收分类");
    jdbc.update("INSERT INTO finished_products (id,name,category_id) VALUES (?,'关联类目验证',99001)", id);
    JsonNode linked = data(mvc.perform(get("/api/admin/finished-products/operation-logs/{id}", createLogId).header("Authorization", token)));
    JsonNode linkedCategory = json.readTree(linked.path("changeDetails").asText()).path("商品分类");
    assertThat(linkedCategory.path("after").asText()).isEqualTo("调整后的一级类目 / 二级类目 / 富文本验收分类");
    assertThat(linkedCategory.path("hint").asText()).contains("商品当前关联类目");



  }

  @Test
  void layeredDimensionsRoundTripWithOrderAndSeparateSkuValues() throws Exception {
    jdbc.update("INSERT INTO product_categories (id, scope, name) VALUES (99031, 'finished', '规格顺序测试')");
    jdbc.update("INSERT INTO suppliers (id, owner_scope, owner_id, name) VALUES (99031, 'platform', 0, '规格供应商')");
    jdbc.update("INSERT INTO supplier_supply_type_links (supplier_id, supply_type_id) VALUES (99031, 2)");
    jdbc.update("UPDATE store_levels SET status = 'disabled'");
    ObjectNode payload = (ObjectNode) json.readTree("""
        {"categoryId":99031,"supplierId":99031,"name":"分层顺序","sku":"layered-test",
         "status":"warehouse","detail":"<p>测试</p>","attributes":[],
         "specDimensions":[{"key":"attribute_2","name":"尺寸","values":["大","小"]},
                           {"key":"attribute_1","name":"颜色","values":["白","黑"]}],
         "variants":[],"guidePrices":[]}
        """);
    payload.put("mainImageMediaId", upload("image/png", "spec.png").path("id").asLong());
    payload.put("videoMediaId", upload("video/webm", "spec.webm").path("id").asLong());
    int index = 0;
    for (String size : List.of("大", "小")) {
      for (String color : List.of("白", "黑")) {
        index++;
        ObjectNode variant = payload.withArray("variants").addObject();
        variant.put("variantKey", "sku-" + index).put("variantLabel", size + color)
            .put("displayMode", "layered").put("stock", index);
        variant.putObject("salesAttributes").put("attribute_2", size).put("attribute_1", color)
            .put("attribute_3", "非组合属性");
        payload.withArray("guidePrices").addObject().put("variantKey", "sku-" + index)
            .put("priceCoefficient", 2).put("costPrice", index).put("price", index * 2);
      }
    }
    JsonNode created = data(mvc.perform(post("/api/admin/finished-products").header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    long id = created.path("id").asLong();
    assertThat(created.path("specDimensions")).isEqualTo(payload.path("specDimensions"));
    JsonNode reloaded = null;
    for (JsonNode item : data(mvc.perform(get("/api/admin/finished-products").header("Authorization", token)))) {
      if (item.path("id").asLong() == id) reloaded = item;
    }
    assertThat(reloaded).isNotNull();
    assertThat(reloaded.path("specDimensions")).isEqualTo(payload.path("specDimensions"));
    assertThat(reloaded.path("variants").size()).isEqualTo(4);
    for (int i = 0; i < 4; i++) {
      assertThat(reloaded.path("variants").get(i).path("salesAttributes"))
          .isEqualTo(payload.path("variants").get(i).path("salesAttributes"));
      assertThat(reloaded.path("variants").get(i).path("variantKey").asText()).isEqualTo("sku-" + (i + 1));
    }
    JsonNode updated = data(mvc.perform(put("/api/admin/finished-products/{id}", id).header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    assertThat(updated.path("specDimensions")).isEqualTo(payload.path("specDimensions"));
    payload.put("status", "recycle");
    data(mvc.perform(put("/api/admin/finished-products/{id}", id).header("Authorization", token)
        .contentType("application/json").content(json.writeValueAsBytes(payload))));
    data(mvc.perform(delete("/api/admin/finished-products/{id}", id).header("Authorization", token)));
  }

  private long referenceCount(long id, String field) {
    return jdbc.queryForObject("""
        SELECT COUNT(*) FROM media_references
        WHERE business_domain = 'FINISHED_PRODUCT' AND business_id = ? AND field_key LIKE ?
        """, Long.class, id, field);
  }

  private JsonNode upload(String type, String name) throws Exception {
    return data(mvc.perform(multipart("/api/admin/finished-products/media")
        .file(new MockMultipartFile("file", name, type, "fixture-content".getBytes(StandardCharsets.UTF_8)))
        .header("Authorization", token)));
  }

  private JsonNode data(ResultActions result) throws Exception {
    JsonNode response = json.readTree(result.andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray());
    assertThat(response.path("code").asInt()).as(response.toString()).isZero();
    return response.path("data");
  }
}
