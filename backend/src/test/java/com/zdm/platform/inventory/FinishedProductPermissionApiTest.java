package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

import com.zdm.platform.support.SpringContainerTestSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zdm.platform.security.CurrentIdentity;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@Testcontainers(disabledWithoutDocker = true)
@Transactional
class FinishedProductPermissionApiTest extends SpringContainerTestSupport {
  private static final String PREFIX = "admin.finished-stock-management.";
  @Container
  private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("finished_permission_test").withUsername("test").withPassword("test");
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
    registry.add("zdm.media.storage-path", () -> System.getProperty("java.io.tmpdir") + "/finished-permission-test");
  }
  @Autowired private MockMvc mvc;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ObjectMapper json;
  @Autowired private org.mybatis.spring.SqlSessionTemplate sqlSession;

  private void identity(String scope, String... actions) { identityFor("admin",scope,actions); }
  private void identityFor(String client,String scope,String... actions) {
    var user = new CurrentIdentity(1L, 1L, 1L, 1L, client, null, null, "权限测试", scope,
        List.of("OPERATOR"), java.util.Arrays.stream(actions).map(action -> client+".finished-stock-management." + action).toList());
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(user, null, List.of()));
  }
  @AfterEach void clear() { SecurityContextHolder.clearContext(); }

  @Test void tabViewLoadsOptionsWithoutGrantingBaseDataManagement() throws Exception {
    jdbc.update("INSERT INTO product_categories (id,name,scope,created_by_account_id) VALUES (99001,'本人分类','finished',1),(99002,'他人分类','finished',2),(99003,'配件分类','accessory',1)");
    jdbc.update("INSERT INTO product_attributes (id,name,scope,value_type,created_by_account_id) VALUES (99001,'本人属性','finished','text',1),(99002,'他人属性','finished','text',2)");
    jdbc.update("INSERT INTO suppliers (id,name,owner_scope,owner_id,contact_phone,created_by_account_id) VALUES (99001,'本人供应商','platform',0,'13900000000',1),(99002,'他人供应商','platform',0,'13800000000',2)");
    jdbc.update("INSERT INTO stores (id,tenant_id,name,type) VALUES (99003,1,'选项隔离门店','partner')");
    jdbc.update("INSERT INTO suppliers (id,name,owner_scope,owner_id,tenant_id,store_id,created_by_account_id) VALUES (99003,'门店供应商','store',99003,1,99003,1)");
    identity("self", "warehouse.view");
    JsonNode options = data(mvc.perform(get("/api/admin/finished-products/form-options")));
    assertThat(options.path("categories").toString()).contains("本人分类").doesNotContain("他人分类", "配件分类");
    assertThat(options.path("attributes").toString()).contains("本人属性").doesNotContain("他人属性");
    assertThat(options.path("suppliers").toString()).contains("本人供应商").doesNotContain("他人供应商", "门店供应商", "contactPhone", "13900000000");
    for (String endpoint : List.of("finished-products/attribute-template-options", "finished-products/price-level-options",
        "finished-markup-configurations/options", "finished-guide-price-setting")) {
      mvc.perform(get("/api/admin/" + endpoint)).andExpect(status().isOk());
    }
    for (String endpoint : List.of("product-categories", "product-attributes", "suppliers", "finished-markup-configurations")) {
      mvc.perform(get("/api/admin/" + endpoint)).andExpect(status().isForbidden());
    }
    identity("all", "warehouse.view");
    JsonNode all = data(mvc.perform(get("/api/admin/finished-products/form-options")));
    assertThat(all.path("categories").toString()).contains("他人分类").doesNotContain("配件分类");
    assertThat(all.path("suppliers").toString()).contains("他人供应商").doesNotContain("门店供应商");
    identity("all");
    mvc.perform(get("/api/admin/finished-products/form-options")).andExpect(status().isForbidden());
  }

  @Test void listOnlyReturnsAuthorizedStatusTabs() throws Exception {
    jdbc.update("INSERT INTO finished_products (id,name,status,created_by_account_id) VALUES (99001,'仓库商品','warehouse',1),(99002,'出售商品','selling',1),(99003,'他人出售商品','selling',2)");
    identity("self", "selling.view");
    mvc.perform(get("/api/admin/finished-products")).andExpect(status().isOk())
        .andExpect(jsonPath("$.data.length()").value(1)).andExpect(jsonPath("$.data[0].id").value(99002));
    identity("all", "operation-log.view");
    mvc.perform(get("/api/admin/finished-products")).andExpect(status().isOk()).andExpect(jsonPath("$.data.length()").value(0));
    identity("all", "warehouse.view", "selling.view");
    mvc.perform(get("/api/admin/finished-products")).andExpect(status().isOk()).andExpect(jsonPath("$.data.length()").value(3));
  }

  @Test void scopedUpdatesPersistOnlyAllowedFieldsAndKeepAccurateLogs() throws Exception {
    jdbc.update("INSERT INTO product_categories (id,name,scope,created_by_account_id) VALUES (99001,'测试分类','finished',1)");
    jdbc.update("INSERT INTO suppliers (id,name,owner_scope,owner_id,created_by_account_id) VALUES (99001,'测试供应商','platform',0,1)");
    jdbc.update("INSERT INTO supplier_supply_type_links (supplier_id,supply_type_id) VALUES (99001,2)");
    jdbc.update("UPDATE store_levels SET status='disabled'");
    jdbc.update("INSERT INTO finished_guide_price_settings (id,price_coefficient) VALUES (1,2) ON DUPLICATE KEY UPDATE price_coefficient=2");
    identityFor("supply-chain","all", "warehouse.view", "warehouse.publish", "warehouse.shelf");
    long image = upload("image/png", "test.png");
    long video = upload("video/webm", "test.webm");
    ObjectNode payload = (ObjectNode) json.readTree("""
        {"name":"原始商品","categoryId":99001,"supplierId":99001,"detail":"<p>原始详情</p>",
         "sku":"permission-test","status":"selling","attributes":[],"markupPrices":[],
         "variants":[{"variantLabel":"单规格","displayMode":"single","stock":5,"costPrice":10}]}
        """);
    payload.put("mainImageMediaId", image).put("videoMediaId", video);
    payload.put("detail", "<p>原始详情</p><img src=\"media:" + image + "\"><video src=\"media:" + video + "\" controls></video>");
    JsonNode created = data(mvc.perform(post("/api/admin/finished-products").contentType("application/json").content(json.writeValueAsBytes(payload))));
    long id = created.path("id").asLong();
    String storedDetail = jdbc.queryForObject("SELECT detail FROM finished_products WHERE id=?", String.class, id);
    assertThat(storedDetail).contains("media:" + image, "media:" + video).doesNotContain("/api/open/media/");
    var mediaReferences = jdbc.queryForList("SELECT field_key,media_id FROM media_references WHERE business_domain='FINISHED_PRODUCT' AND business_id=? ORDER BY field_key", id);
    ObjectNode request = created.deepCopy();
    request.put("name", "夹带名称").put("detail", "<p>夹带详情</p>").put("totalStock", 999);
    ((ObjectNode) request.path("variants").get(0)).put("stock", 999);
    ((ObjectNode) request.path("guidePrices").get(0)).put("priceCoefficient", 3).put("price", 30);
    identity("all", "warehouse.view", "warehouse.price");
    JsonNode priced = data(mvc.perform(put("/api/admin/finished-products/{id}", id).contentType("application/json").content(json.writeValueAsBytes(request))));
    assertThat(priced.path("name").asText()).isEqualTo("原始商品");
    assertThat(priced.path("totalStock").asInt()).isEqualTo(5);
    assertThat(priced.path("guidePrices").get(0).path("price").asInt()).isEqualTo(30);
    assertThat(jdbc.queryForObject("SELECT detail FROM finished_products WHERE id=?", String.class, id)).isEqualTo(storedDetail);
    String priceLog = jdbc.queryForObject("SELECT change_details FROM finished_operation_logs WHERE product_id=? ORDER BY id DESC LIMIT 1", String.class, id);
    assertThat(priceLog).contains("指导价").doesNotContain("夹带名称");
    request.put("status", "selling");
    mvc.perform(put("/api/admin/finished-products/{id}", id).contentType("application/json").content(json.writeValueAsBytes(request))).andExpect(status().isForbidden());
    identity("all", "warehouse.view", "warehouse.shelf");
    ((ObjectNode) request.path("guidePrices").get(0)).put("price", 999);
    JsonNode shelved = data(mvc.perform(put("/api/admin/finished-products/{id}", id).contentType("application/json").content(json.writeValueAsBytes(request))));
    assertThat(shelved.path("status").asText()).isEqualTo("selling");
    assertThat(shelved.path("name").asText()).isEqualTo("原始商品");
    assertThat(shelved.path("guidePrices").get(0).path("price").asInt()).isEqualTo(30);
    JsonNode log = json.readTree(jdbc.queryForObject("SELECT change_details FROM finished_operation_logs WHERE product_id=? ORDER BY id DESC LIMIT 1", String.class, id));
    assertThat(log.path("状态").path("before").asText()).isEqualTo("warehouse");
    assertThat(log.path("状态").path("after").asText()).isEqualTo("selling");
    assertThat(log.has("宝贝详情")).isFalse();
    assertThat(log.size()).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT detail FROM finished_products WHERE id=?", String.class, id)).isEqualTo(storedDetail);
    identity("all", "warehouse.view", "warehouse.shelf", "selling.view", "selling.off-shelf", "off-shelf.view", "off-shelf.restore");
    String previousStatus = "selling";
    for (String target : List.of("offShelf", "warehouse", "selling")) {
      request.put("status", target).put("offShelfReason", "库存异常").put("offShelfDetail", "核对库存");
      JsonNode updated = data(mvc.perform(put("/api/admin/finished-products/{id}", id).contentType("application/json").content(json.writeValueAsBytes(request))));
      assertThat(updated.path("status").asText()).isEqualTo(target);
      assertThat(updated.path("detail").asText()).contains("/api/open/media/").doesNotContain("media:");
      assertThat(jdbc.queryForObject("SELECT detail FROM finished_products WHERE id=?", String.class, id)).isEqualTo(storedDetail);
      assertThat(jdbc.queryForList("SELECT field_key,media_id FROM media_references WHERE business_domain='FINISHED_PRODUCT' AND business_id=? ORDER BY field_key", id)).isEqualTo(mediaReferences);
      JsonNode statusLog = json.readTree(jdbc.queryForObject("SELECT change_details FROM finished_operation_logs WHERE product_id=? ORDER BY id DESC LIMIT 1", String.class, id));
      assertThat(statusLog.path("状态").path("before").asText()).isEqualTo(previousStatus);
      assertThat(statusLog.path("状态").path("after").asText()).isEqualTo(target);
      assertThat(statusLog.has("宝贝详情")).isFalse();
      previousStatus = target;
    }
    identity("all", "sold-out.view", "sold-out.price");
    mvc.perform(multipart("/api/admin/finished-products/media").file(new MockMultipartFile("file", "test.png", "image/png", new byte[]{1})))
        .andExpect(status().isForbidden());
  }

  @Test void attributeEditPersistsOnlyDifferencesAndNoOpDoesNotAddLog() throws Exception {
    ObjectNode product = sourceFixture("平台发布", "warehouse");
    long id = product.path("id").asLong();
    jdbc.update("INSERT INTO product_attributes (id,name,scope,value_type,created_by_account_id) VALUES (99021,'材质','finished','text',1),(99022,'颜色','finished','text',1),(99023,'尺寸','finished','text',1),(99024,'纹理','finished','text',1)");
    product.set("attributes", json.readTree("""
        [{"attributeId":99021,"attributeName":"材质","value":"石材"},
         {"attributeId":99022,"attributeName":"颜色","value":"白"},
         {"attributeId":99023,"attributeName":"尺寸","value":"大"}]
        """));
    data(mvc.perform(put("/api/admin/finished-products/{id}", id).contentType("application/json").content(json.writeValueAsBytes(product))));
    product = sourceRecord(id);
    product.set("attributes", json.readTree("""
        [{"attributeId":99022,"attributeName":"颜色","value":"黑"},
         {"attributeId":99021,"attributeName":"材质","value":"石材"},
         {"attributeId":99024,"attributeName":"纹理","value":"直纹"}]
        """));
    data(mvc.perform(put("/api/admin/finished-products/{id}", id).contentType("application/json").content(json.writeValueAsBytes(product))));
    String stored = jdbc.queryForObject("SELECT change_details FROM finished_operation_logs WHERE product_id=? ORDER BY id DESC LIMIT 1", String.class, id);
    JsonNode change = json.readTree(stored).path("商品属性");
    assertThat(change.path("before").size()).isEqualTo(2);
    assertThat(change.path("after").size()).isEqualTo(2);
    assertThat(change.path("changeTypes").path("99022").asText()).isEqualTo("MODIFY");
    assertThat(change.path("changeTypes").path("99023").asText()).isEqualTo("REMOVE");
    assertThat(change.path("changeTypes").path("99024").asText()).isEqualTo("ADD");
    assertThat(stored).doesNotContain("材质");
    Long count = jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=?", Long.class, id);
    product = sourceRecord(id);
    var reversed = json.createArrayNode();
    for (int index = product.path("attributes").size() - 1; index >= 0; index--) {
      reversed.add(product.path("attributes").get(index));
    }
    product.set("attributes", reversed);
    data(mvc.perform(put("/api/admin/finished-products/{id}", id).contentType("application/json").content(json.writeValueAsBytes(product))));
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=?", Long.class, id)).isEqualTo(count);
  }

  @Test void operationsDetailChecksStatusPermissionsScopeAndClientWithoutWritingLogs() throws Exception {
    ObjectNode created = sourceFixture("平台发布", "selling");
    long id = created.path("id").asLong();
    Long count = jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=?", Long.class, id);
    String[][] states = {{"warehouse", "warehouse"}, {"selling", "selling"}, {"offShelf", "off-shelf"}, {"soldOut", "sold-out"}, {"recycle", "recycle"}};
    for (String[] state : states) {
      jdbc.update("UPDATE finished_products SET status=? WHERE id=?", state[0], id);
      sqlSession.clearCache();
      identity("all", state[1] + ".view");
      mvc.perform(get("/api/admin/finished-products/{id}", id)).andExpect(status().isForbidden());
      identity("all", state[1] + ".detail", state[1] + ".view");
      JsonNode detail = data(mvc.perform(get("/api/admin/finished-products/{id}", id)));
      assertThat(detail.path("id").asLong()).isEqualTo(id);
      assertThat(detail.path("variants").size()).isEqualTo(1);
      assertThat(detail.path("detail").asText()).contains("待核对商品资料");
      identity("all", "warehouse.view", "selling.detail");
      mvc.perform(get("/api/admin/finished-products/{id}", id)).andExpect(status().isForbidden());
    }
    jdbc.update("UPDATE finished_products SET status='warehouse', source_status='offShelf' WHERE id=?", id);
    sqlSession.clearCache();
    identity("self", "warehouse.view", "warehouse.detail");
    mvc.perform(get("/api/admin/finished-products/{id}", id)).andExpect(status().isOk())
        .andExpect(jsonPath("$.data.sourceUnavailable").value(true));
    jdbc.update("UPDATE finished_products SET source_status='purged' WHERE id=?", id);
    sqlSession.clearCache();
    mvc.perform(get("/api/admin/finished-products/{id}", id)).andExpect(status().isOk());
    jdbc.update("UPDATE finished_products SET created_by_account_id=2 WHERE id=?", id);
    sqlSession.clearCache();
    mvc.perform(get("/api/admin/finished-products/{id}", id)).andExpect(status().isBadRequest());
    for (String client : List.of("supply-chain", "store", "supplier")) {
      fullIdentity(client);
      mvc.perform(get("/api/admin/finished-products/{id}", id)).andExpect(status().isForbidden());
    }
    identity("all", "warehouse.view", "warehouse.detail");
    jdbc.update("UPDATE finished_products SET operations_deleted=1 WHERE id=?", id);
    sqlSession.clearCache();
    mvc.perform(get("/api/admin/finished-products/{id}", id)).andExpect(status().isBadRequest());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=?", Long.class, id)).isEqualTo(count);
  }


  private long upload(String type, String name) throws Exception {
    return data(mvc.perform(multipart("/api/admin/finished-products/media")
        .file(new MockMultipartFile("file", name, type, "fixture-content".getBytes(java.nio.charset.StandardCharsets.UTF_8)))))
        .path("id").asLong();
  }
  private void fullIdentity(String client) {
    var user=new CurrentIdentity(1L,1L,1L,1L,client,null,null,"跨端测试","all",List.of("OPERATOR"),List.of("all"));
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(user,null,List.of()));
  }
  @Test void skuIdentitySurvivesEditsAndRejectsForeignOrDuplicateIds() throws Exception {
    ObjectNode product = sourceFixture("平台发布", "selling");
    product.put("status", "selling");
    long productId = product.path("id").asLong();
    long skuId = product.path("variants").get(0).path("id").asLong();
    assertThat(product.path("guidePrices").get(0).path("skuId").asLong()).isEqualTo(skuId);
    ((ObjectNode) product.path("variants").get(0)).put("variantLabel", "修改后的规格").put("stock", 7);
    fullIdentity("supply-chain");
    ObjectNode updated = (ObjectNode)data(mvc.perform(put("/api/admin/finished-products/{id}", productId)
        .contentType("application/json").content(json.writeValueAsBytes(product))));
    assertThat(updated.path("variants").get(0).path("id").asLong()).isEqualTo(skuId);
    assertThat(updated.path("guidePrices").get(0).path("skuId").asLong()).isEqualTo(skuId);
    assertThat(updated.path("guidePrices").get(0).path("variantLabel").asText()).isEqualTo("修改后的规格");
    // New rows receive fresh IDs without replacing existing rows.
    ObjectNode added = updated.withArray("variants").addObject();
    added.put("variantLabel", "新增规格").put("displayMode", "single").put("stock", 2).put("costPrice", 20);
    updated.put("status", "selling");
    fullIdentity("supply-chain");
    updated = (ObjectNode)data(mvc.perform(put("/api/admin/finished-products/{id}", productId)
        .contentType("application/json").content(json.writeValueAsBytes(updated))));
    long newSkuId = updated.path("variants").get(1).path("id").asLong();
    assertThat(newSkuId).isNotEqualTo(skuId).isPositive();
    assertThat(updated.path("guidePrices").size()).isEqualTo(2);
    assertThat(updated.path("variants").get(0).path("id").asLong()).isEqualTo(skuId);
    updated.put("status", "selling");
    ObjectNode invalid = updated.deepCopy();
    ((ObjectNode)invalid.path("variants").get(1)).put("id", skuId);
    fullIdentity("supply-chain");
    mvc.perform(put("/api/admin/finished-products/{id}", productId).contentType("application/json")
        .content(json.writeValueAsBytes(invalid))).andExpect(status().isBadRequest());
    jdbc.update("INSERT INTO finished_products (id,name) VALUES (99199,'其他商品')");
    jdbc.update("INSERT INTO finished_product_variants (id,finished_product_id,variant_label,stock,cost_price) VALUES (99199,99199,'其他 SKU',1,20)");
    ((ObjectNode)invalid.path("variants").get(1)).put("id", 99199);
    fullIdentity("supply-chain");
    mvc.perform(put("/api/admin/finished-products/{id}", productId).contentType("application/json")
        .content(json.writeValueAsBytes(invalid))).andExpect(status().isBadRequest());
    assertThat(jdbc.queryForObject("SELECT finished_product_id FROM finished_product_variants WHERE id=99199",Long.class)).isEqualTo(99199);
    // Removing a SKU removes only its prices, keeping the remaining SKU identity.
    updated.withArray("variants").remove(1);
    fullIdentity("supply-chain");
    ObjectNode removed = (ObjectNode)data(mvc.perform(put("/api/admin/finished-products/{id}", productId)
        .contentType("application/json").content(json.writeValueAsBytes(updated))));
    assertThat(removed.path("variants").size()).isEqualTo(1);
    assertThat(removed.path("variants").get(0).path("id").asLong()).isEqualTo(skuId);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_product_guide_prices WHERE sku_id=?",Long.class,newSkuId)).isZero();
    fullIdentity("admin");
    ((ObjectNode)removed.path("guidePrices").get(0)).put("skuId",99199);
    removed.put("status", "warehouse");
    mvc.perform(put("/api/admin/finished-products/{id}", productId).contentType("application/json")
        .content(json.writeValueAsBytes(removed))).andExpect(status().isForbidden());
  }

  @org.junit.jupiter.params.ParameterizedTest
  @org.junit.jupiter.params.provider.ValueSource(strings = {"warehouse", "selling"})
  void arrivalRetainsCompleteSnapshotAndMediaAfterProductChanges(String initialStatus) throws Exception {
    ObjectNode created = sourceFixture("平台发布", initialStatus);
    long id = created.path("id").asLong();
    if ("warehouse".equals(initialStatus)) { sourceStatus(id, "selling"); }
    long logId = jdbc.queryForObject("SELECT id FROM finished_operation_logs WHERE product_id=? AND business_client_code='admin' AND operation_type='SOURCE_SHELF'", Long.class, id);
    String saved = jdbc.queryForObject("SELECT change_details FROM finished_operation_logs WHERE id=?", String.class, logId);
    JsonNode snapshot = json.readTree(saved);
    assertThat(snapshot.path("商品名称").path("after").asText()).isEqualTo("跨端商品");
    assertThat(snapshot.path("商品分类").path("after").asText()).isEqualTo("跨端测试分类");
    assertThat(snapshot.path("供应商").path("after").asText()).isEqualTo("跨端测试供应商");
    assertThat(snapshot.has("商品属性")).isTrue();
    assertThat(snapshot.path("销售规格").path("after").get(0).path("skuId").asLong())
        .isEqualTo(created.path("variants").get(0).path("id").asLong());
    assertThat(snapshot.path("指导价").path("after").get(0).path("price").asInt()).isEqualTo(20);
    assertThat(snapshot.has("层级价格")).isTrue();
    assertThat(snapshot.path("状态").path("after").asText()).isEqualTo("warehouse");
    assertThat(snapshot.path("媒体").path("after").size()).isEqualTo(2);
    assertThat(snapshot.has("入仓价格")).isFalse();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE business_domain='FINISHED_PRODUCT_LOG' AND business_id=? AND reference_kind='HISTORY'", Integer.class, logId)).isEqualTo(2);
    ObjectNode changed = sourceRecord(id);
    changed.put("status", "selling").put("name", "修改后的商品").put("detail", "<p>修改后的详情</p>");
    ((ObjectNode) changed.path("variants").get(0)).put("costPrice", 30);
    data(mvc.perform(put("/api/admin/finished-products/{id}", id).contentType("application/json").content(json.writeValueAsBytes(changed))));
    jdbc.update("UPDATE suppliers SET name='修改后的供应商' WHERE id=99010");
    assertThat(jdbc.queryForObject("SELECT change_details FROM finished_operation_logs WHERE id=?", String.class, logId)).isEqualTo(saved);
    fullIdentity("admin");
    JsonNode detail = data(mvc.perform(get("/api/admin/finished-products/operation-logs/{id}", logId)));
    JsonNode historical = json.readTree(detail.path("changeDetails").asText());
    assertThat(historical.path("宝贝详情").path("after").asText()).contains("待核对商品资料");
    assertThat(historical.path("媒体").path("after").get(0).path("resource").path("available").asBoolean()).isTrue();
    fullIdentity("supply-chain");
    mvc.perform(get("/api/admin/finished-products/operation-logs/{id}", logId)).andExpect(status().isBadRequest());
  }

  @Test
  void persistsFormOrderWithoutCreatingOrderOnlyLogsAndFreezesItOnEdit() throws Exception {
    long id = sourceFixture("平台发布", "warehouse").path("id").asLong();
    String originalLog = jdbc.queryForObject("SELECT change_details FROM finished_operation_logs WHERE product_id=?", String.class, id);
    ObjectNode request = sourceRecord(id);
    request.set("attributeDisplayOrder", json.readTree("{\"product\":[\"12\",\"2\"],\"sales\":[\"attribute_12\",\"attribute_2\"]}"));
    data(mvc.perform(put("/api/admin/finished-products/{id}", id).contentType("application/json").content(json.writeValueAsBytes(request))));
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=?", Long.class, id)).isEqualTo(1);
    ObjectNode persisted = sourceRecord(id);
    assertThat(persisted.path("attributeDisplayOrder")).isEqualTo(request.path("attributeDisplayOrder"));
    ((ObjectNode) persisted.path("variants").get(0)).put("variantLabel", "修改后的规格");
    data(mvc.perform(put("/api/admin/finished-products/{id}", id).contentType("application/json").content(json.writeValueAsBytes(persisted))));
    String edited = jdbc.queryForObject("SELECT change_details FROM finished_operation_logs WHERE product_id=? ORDER BY id DESC LIMIT 1", String.class, id);
    assertThat(json.readTree(edited).path("字段顺序").path("after")).isEqualTo(request.path("attributeDisplayOrder"));
    assertThat(jdbc.queryForObject("SELECT change_details FROM finished_operation_logs WHERE product_id=? ORDER BY id LIMIT 1", String.class, id)).isEqualTo(originalLog);
  }

  @Test
  void operationsShelfChecksAllTierPricesBeforeConfirmAndAgainAtSubmission() throws Exception {
    long id = sourceFixture("平台发布", "selling").path("id").asLong();
    jdbc.update("INSERT INTO store_levels (id,name,sort_order) VALUES (99551,'运营补齐价格级别',1)");
    identity("all", "warehouse.view", "warehouse.shelf");
    mvc.perform(post("/api/admin/finished-products/{id}/shelf-check", id))
        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("请完善全部成品现货价格后再上架"));
    mvc.perform(put("/api/admin/finished-products/{id}", id).contentType("application/json").content("{\"name\":\"跨端商品\",\"status\":\"selling\"}"))
        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("请完善全部成品现货价格后再上架"));
    assertThat(jdbc.queryForObject("SELECT status FROM finished_products WHERE id=?",String.class,id)).isEqualTo("warehouse");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=? AND business_client_code='admin' AND operation_type='SHELF'",Long.class,id)).isZero();
    jdbc.update("""
        INSERT INTO finished_product_prices
          (finished_product_id,sku_id,variant_label,store_level_id,store_level_name,price_coefficient,cost_price,price,price_source)
        SELECT finished_product_id,id,variant_label,99551,'运营补齐价格级别',1.5,cost_price,cost_price*1.5,'manual'
        FROM finished_product_variants WHERE finished_product_id=?
        """,id);
    sqlSession.clearCache();
    data(mvc.perform(post("/api/admin/finished-products/{id}/shelf-check", id)));
    assertThat(jdbc.queryForObject("SELECT status FROM finished_products WHERE id=?",String.class,id)).isEqualTo("warehouse");
    data(mvc.perform(put("/api/admin/finished-products/{id}", id).contentType("application/json").content("{\"name\":\"跨端商品\",\"status\":\"selling\"}")));
    assertThat(jdbc.queryForObject("SELECT status FROM finished_products WHERE id=?",String.class,id)).isEqualTo("selling");
  }

  @ParameterizedTest
  @ValueSource(strings = {"guide", "cost", "stock", "image", "category"})
  void operationsShelfRejectsIncompleteProductInformation(String missing) throws Exception {
    long id = sourceFixture("平台发布", "selling").path("id").asLong();
    switch (missing) {
      case "guide" -> jdbc.update("DELETE FROM finished_product_guide_prices WHERE finished_product_id=?",id);
      case "cost" -> jdbc.update("UPDATE finished_product_variants SET cost_price=NULL WHERE finished_product_id=?",id);
      case "stock" -> jdbc.update("UPDATE finished_products SET total_stock=0 WHERE id=?",id);
      case "image" -> {
        jdbc.update("UPDATE finished_products SET main_image_media_id=NULL WHERE id=?",id);
        jdbc.update("DELETE FROM media_references WHERE business_domain='FINISHED_PRODUCT' AND business_id=? AND field_key LIKE 'mainImage%'",id);
      }
      case "category" -> jdbc.update("UPDATE finished_products SET category_id=NULL WHERE id=?",id);
      default -> throw new AssertionError(missing);
    }
    sqlSession.clearCache();
    identity("all", "warehouse.view", "warehouse.batch-shelf");
    byte[] checkResponse = mvc.perform(post("/api/admin/finished-products/{id}/shelf-check",id))
        .andExpect(status().isBadRequest()).andReturn().getResponse().getContentAsByteArray();
    String expectedMessage = json.readTree(checkResponse).path("message").asText();
    mvc.perform(put("/api/admin/finished-products/{id}",id).contentType("application/json").content("{\"name\":\"跨端商品\",\"status\":\"selling\"}"))
        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value(expectedMessage));
    assertThat(jdbc.queryForObject("SELECT status FROM finished_products WHERE id=?",String.class,id)).isEqualTo("warehouse");
  }

  @Test
  void operationsShelfCheckPreservesFunctionDataAndClientBoundaries() throws Exception {
    long id = sourceFixture("平台发布", "selling").path("id").asLong();
    identity("all", "warehouse.view");
    mvc.perform(post("/api/admin/finished-products/{id}/shelf-check",id)).andExpect(status().isForbidden());
    jdbc.update("UPDATE finished_products SET created_by_account_id=2 WHERE id=?",id);
    sqlSession.clearCache();
    identity("self", "warehouse.view", "warehouse.shelf");
    mvc.perform(post("/api/admin/finished-products/{id}/shelf-check",id)).andExpect(status().isForbidden());
    identityFor("supply-chain", "all", "warehouse.shelf");
    mvc.perform(post("/api/admin/finished-products/{id}/shelf-check",id)).andExpect(status().isForbidden());
  }

  private ObjectNode sourceFixture(String publisher,String status) throws Exception {
    jdbc.update("INSERT INTO product_categories (id,name,scope,created_by_account_id) VALUES (99010,'跨端测试分类','finished',1)");
    jdbc.update("INSERT INTO suppliers (id,name,owner_scope,owner_id,created_by_account_id) VALUES (99010,'跨端测试供应商','platform',0,1)");
    jdbc.update("INSERT INTO supplier_supply_type_links (supplier_id,supply_type_id) VALUES (99010,2)");
    jdbc.update("UPDATE store_levels SET status='disabled'");
    jdbc.update("INSERT INTO finished_guide_price_settings (id,price_coefficient) VALUES (1,2) ON DUPLICATE KEY UPDATE price_coefficient=2");
    fullIdentity("supply-chain");
    ObjectNode payload=(ObjectNode)json.readTree("""
        {"name":"跨端商品","categoryId":99010,"supplierId":99010,"detail":"<p>待核对商品资料</p>",
         "attributes":[],"variants":[{"variantLabel":"单规格","displayMode":"single","stock":5,"costPrice":10}]}
        """);
    payload.put("mainImageMediaId",upload("image/png","source.png")).put("videoMediaId",upload("video/webm","source.webm"));
    payload.put("publisherType",publisher).put("status",status);
    return (ObjectNode)data(mvc.perform(post("/api/admin/finished-products").contentType("application/json").content(json.writeValueAsBytes(payload))));
  }
  private ObjectNode sourceRecord(long id) throws Exception {
    fullIdentity("supply-chain");
    for(JsonNode row:data(mvc.perform(get("/api/admin/finished-products")))) if(row.path("id").asLong()==id) return (ObjectNode)row;
    throw new AssertionError("来源商品不存在");
  }
  private JsonNode operationRecord(long id) throws Exception {
    fullIdentity("admin");
    for(JsonNode row:data(mvc.perform(get("/api/admin/finished-products")))) if(row.path("id").asLong()==id) return row;
    return null;
  }
  private void sourceStatus(long id,String target) throws Exception {
    ObjectNode row=sourceRecord(id);row.put("status",target).put("offShelfReason","库存异常");
    data(mvc.perform(put("/api/admin/finished-products/{id}",id).contentType("application/json").content(json.writeValueAsBytes(row))));
  }
  @Test void publicationGateAndIndependentLifecyclesSurviveDeletionAndRepublication() throws Exception {
    long id=sourceFixture("平台发布","warehouse").path("id").asLong();
    assertThat(operationRecord(id)).isNull();
    sourceStatus(id,"selling");
    ObjectNode ops=(ObjectNode)operationRecord(id);
    assertThat(ops.path("status").asText()).isEqualTo("warehouse");
    assertThat(ops.path("guidePrices").get(0).path("price").asInt()).isEqualTo(20);
    ops.put("status","selling");
    data(mvc.perform(put("/api/admin/finished-products/{id}",id).contentType("application/json").content(json.writeValueAsBytes(ops))));
    sourceStatus(id,"offShelf");
    assertThat(operationRecord(id).path("sourceUnavailable").asBoolean()).isTrue();
    assertThat(operationRecord(id).path("status").asText()).isEqualTo("selling");
    mvc.perform(put("/api/admin/finished-products/{id}",id).contentType("application/json").content(json.writeValueAsBytes(ops))).andExpect(status().isBadRequest());
    sourceStatus(id,"warehouse");
    assertThat(operationRecord(id).path("sourceUnavailable").asBoolean()).isTrue();
    sourceStatus(id,"selling");
    assertThat(operationRecord(id).path("sourceUnavailable").asBoolean()).isFalse();
    assertThat(operationRecord(id).path("status").asText()).isEqualTo("selling");
    sourceStatus(id,"offShelf");fullIdentity("admin");
    data(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/admin/finished-products/{id}",id)));
    assertThat(operationRecord(id)).isNull();
    sourceStatus(id,"warehouse");assertThat(operationRecord(id)).isNull();
    ObjectNode row=sourceRecord(id);row.put("status","warehouse");((ObjectNode)row.path("variants").get(0)).put("costPrice",30);
    data(mvc.perform(put("/api/admin/finished-products/{id}",id).contentType("application/json").content(json.writeValueAsBytes(row))));
    assertThat(operationRecord(id)).isNull();
    sourceStatus(id,"recycle");sourceStatus(id,"warehouse");assertThat(operationRecord(id)).isNull();
    sourceStatus(id,"selling");
    assertThat(operationRecord(id).path("status").asText()).isEqualTo("warehouse");
    assertThat(operationRecord(id).path("guidePrices").get(0).path("price").asInt()).isEqualTo(60);
    ObjectNode edited=sourceRecord(id);edited.put("status","selling");((ObjectNode)edited.path("variants").get(0)).put("costPrice",40);
    data(mvc.perform(put("/api/admin/finished-products/{id}",id).contentType("application/json").content(json.writeValueAsBytes(edited))));
    assertThat(operationRecord(id).path("guidePrices").get(0).path("price").asInt()).isEqualTo(80);
    sourceStatus(id,"offShelf");sourceStatus(id,"recycle");fullIdentity("supply-chain");
    data(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/admin/finished-products/{id}",id)));
    assertThat(operationRecord(id).path("sourceStatus").asText()).isEqualTo("purged");
    assertThat(operationRecord(id).path("sourceUnavailable").asBoolean()).isTrue();
    data(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/admin/finished-products/{id}",id)));
    assertThat(operationRecord(id)).isNull();
  }
  @ParameterizedTest
  @ValueSource(strings = {"warehouse", "selling", "offShelf", "soldOut", "recycle"})
  void operationPurgeRecordsActualPreviousStateAndPermanentDeletion(String operationStatus) throws Exception {
    long id = sourceFixture("平台发布", "selling").path("id").asLong();
    jdbc.update("UPDATE finished_products SET status=? WHERE id=?", operationStatus, id);
    sourceStatus(id, "offShelf");
    sourceStatus(id, "recycle");
    data(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/admin/finished-products/{id}", id)));
    JsonNode operations = operationRecord(id);
    assertThat(operations.path("status").asText()).isEqualTo(operationStatus);
    assertThat(operations.path("sourceStatus").asText()).isEqualTo("purged");
    data(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/admin/finished-products/{id}", id)));
    var log = jdbc.queryForMap("SELECT before_status,after_status FROM finished_operation_logs WHERE product_id=? AND business_client_code='admin' AND operation_type='PURGE'", id);
    assertThat(log.get("before_status")).isEqualTo(operationStatus);
    assertThat(log.get("after_status")).isEqualTo("purged");
    assertThat(operationRecord(id)).isNull();
  }

  @Test void deletingUnpublishedSourceDoesNotCreateOperationsLogs() throws Exception {
    long id = sourceFixture("平台发布", "warehouse").path("id").asLong();
    sourceStatus(id, "recycle");
    sourceStatus(id, "warehouse");
    sourceStatus(id, "recycle");
    data(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/admin/finished-products/{id}", id)));
    assertThat(operationRecord(id)).isNull();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=? AND business_client_code='admin'", Long.class, id)).isZero();
    assertThat(jdbc.queryForList("SELECT operation_type FROM finished_operation_logs WHERE product_id=? AND business_client_code='supply-chain' ORDER BY id", String.class, id))
        .containsExactly("CREATE", "DELETE_TO_RECYCLE", "RESTORE", "DELETE_TO_RECYCLE", "PURGE");
  }

  @Test void importedProductsAlwaysEnterSourceWarehouseEvenWhenRequestAsksToPublish() throws Exception {
    ObjectNode created=sourceFixture("接口获取","selling");long id=created.path("id").asLong();
    assertThat(created.path("sourceStatus").asText()).isEqualTo("warehouse");
    assertThat(operationRecord(id)).isNull();
    sourceStatus(id,"selling");assertThat(operationRecord(id)).isNotNull();
  }
  @Test void soldOutSourceCannotBeEditedDeletedOrReplenished() throws Exception {
    long id=sourceFixture("平台发布","warehouse").path("id").asLong();
    jdbc.update("UPDATE finished_products SET source_status='soldOut',total_stock=0 WHERE id=?",id);
    ObjectNode row=sourceRecord(id);row.put("status","soldOut");
    mvc.perform(put("/api/admin/finished-products/{id}",id).contentType("application/json").content(json.writeValueAsBytes(row))).andExpect(status().isBadRequest());
    row.put("status","recycle");
    mvc.perform(put("/api/admin/finished-products/{id}",id).contentType("application/json").content(json.writeValueAsBytes(row))).andExpect(status().isForbidden());
  }

  private JsonNode data(ResultActions result) throws Exception {
    JsonNode response = json.readTree(result.andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray());
    assertThat(response.path("code").asInt()).as(response.toString()).isZero();
    return response.path("data");
  }
}
