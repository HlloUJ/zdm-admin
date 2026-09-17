package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zdm.platform.security.CurrentIdentity;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
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
class FinishedProductPermissionApiTest {
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
         "variants":[{"variantKey":"one","variantLabel":"单规格","displayMode":"single","stock":5,"costPrice":10}],
         "guidePrices":[{"variantKey":"one","priceCoefficient":2,"costPrice":10,"price":20}]}
        """);
    payload.put("mainImageMediaId", image).put("videoMediaId", video);
    JsonNode created = data(mvc.perform(post("/api/admin/finished-products").contentType("application/json").content(json.writeValueAsBytes(payload))));
    long id = created.path("id").asLong();
    ObjectNode request = created.deepCopy();
    request.put("name", "夹带名称").put("detail", "<p>夹带详情</p>").put("totalStock", 999);
    ((ObjectNode) request.path("variants").get(0)).put("stock", 999);
    ((ObjectNode) request.path("guidePrices").get(0)).put("priceCoefficient", 3).put("price", 30);
    identity("all", "warehouse.view", "warehouse.price");
    JsonNode priced = data(mvc.perform(put("/api/admin/finished-products/{id}", id).contentType("application/json").content(json.writeValueAsBytes(request))));
    assertThat(priced.path("name").asText()).isEqualTo("原始商品");
    assertThat(priced.path("totalStock").asInt()).isEqualTo(5);
    assertThat(priced.path("guidePrices").get(0).path("price").asInt()).isEqualTo(30);
    assertThat(jdbc.queryForObject("SELECT detail FROM finished_products WHERE id=?", String.class, id)).contains("原始详情");
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
    identity("all", "sold-out.view", "sold-out.price");
    mvc.perform(multipart("/api/admin/finished-products/media").file(new MockMultipartFile("file", "test.png", "image/png", new byte[]{1})))
        .andExpect(status().isForbidden());
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
  private ObjectNode sourceFixture(String publisher,String status) throws Exception {
    jdbc.update("INSERT INTO product_categories (id,name,scope,created_by_account_id) VALUES (99010,'跨端测试分类','finished',1)");
    jdbc.update("INSERT INTO suppliers (id,name,owner_scope,owner_id,created_by_account_id) VALUES (99010,'跨端测试供应商','platform',0,1)");
    jdbc.update("INSERT INTO supplier_supply_type_links (supplier_id,supply_type_id) VALUES (99010,2)");
    jdbc.update("UPDATE store_levels SET status='disabled'");
    jdbc.update("INSERT INTO finished_guide_price_settings (id,price_coefficient) VALUES (1,2) ON DUPLICATE KEY UPDATE price_coefficient=2");
    fullIdentity("supply-chain");
    ObjectNode payload=(ObjectNode)json.readTree("""
        {"name":"跨端商品","categoryId":99010,"supplierId":99010,"detail":"<p>待核对商品资料</p>",
         "attributes":[],"variants":[{"variantKey":"one","variantLabel":"单规格","displayMode":"single","stock":5,"costPrice":10}]}
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
