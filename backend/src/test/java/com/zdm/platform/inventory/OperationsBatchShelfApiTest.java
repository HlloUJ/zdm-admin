package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.reset;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.support.SpringContainerTestSupport;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@Testcontainers(disabledWithoutDocker = true)
class OperationsBatchShelfApiTest extends SpringContainerTestSupport {
  @Container private static final MySQLContainer<?> MYSQL = com.zdm.platform.support.MySqlTestDatabase.create().withDatabaseName("batch_shelf").withUsername("test").withPassword("test");
  @DynamicPropertySource static void database(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", MYSQL::getJdbcUrl); r.add("spring.datasource.username", MYSQL::getUsername); r.add("spring.datasource.password", MYSQL::getPassword);
  }
  @Autowired private JdbcTemplate jdbc;
  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper json;
  @Autowired private OperationsBatchShelfService batches;
  @Autowired private com.zdm.platform.media.MediaAssetService media;
  @SpyBean private FinishedOperationLogService finishedLogs;
  private static final AtomicLong COUNTER = new AtomicLong(10000);
  @BeforeEach void setup() {
    jdbc.update("UPDATE stores SET store_level_id=NULL");
    jdbc.update("UPDATE store_levels SET status='disabled'");
    jdbc.update("INSERT INTO store_levels(id,name,status,sort_order) VALUES(99590,'批量测试级别','enabled',1) ON DUPLICATE KEY UPDATE status='enabled'");
    for (String kind : List.of("finished", "accessory", "slab")) {
      jdbc.update("INSERT INTO " + kind + "_markup_configurations(id,name,store_level_id,price_coefficient,status,legacy_seeded,sort_order) VALUES(99590,'批量测试级别',99590,1.5,'enabled',false,1) ON DUPLICATE KEY UPDATE status='enabled'");
    }
    jdbc.update("INSERT IGNORE INTO slab_varieties(id,name) VALUES(99590,'批量品种')");
    jdbc.update("INSERT IGNORE INTO slab_origins(id,name) VALUES(99590,'批量产地')");
    jdbc.update("INSERT IGNORE INTO slab_textures(id,name) VALUES(99590,'批量纹理')");
    jdbc.update("INSERT IGNORE INTO slab_color_categories(id,name) VALUES(99590,'批量色系分类')");
    jdbc.update("INSERT IGNORE INTO slab_colors(id,category_id,name) VALUES(99590,99590,'批量色系')");
    jdbc.update("INSERT IGNORE INTO slab_grades(id,code,name) VALUES(99590,'BATCH','批量等级')");
    jdbc.update("INSERT IGNORE INTO suppliers(id,name,owner_scope,owner_id,created_by_account_id) VALUES(99090,'批量供应商','platform',0,1)");
    jdbc.update("INSERT IGNORE INTO supplier_supply_type_links(supplier_id,supply_type_id) VALUES(99090,1),(99090,2),(99090,3)");
    for (String kind : List.of("finished", "accessory")) {
      jdbc.update("INSERT IGNORE INTO product_categories(id,name,scope,created_by_account_id) VALUES(?, '批量分类',?,1)", "finished".equals(kind) ? 99091 : 99092, kind);
      jdbc.update("INSERT INTO " + kind + "_guide_price_settings(id,price_coefficient) VALUES(1,2) ON DUPLICATE KEY UPDATE price_coefficient=2");
    }
  }
  @AfterEach void clear() { reset(finishedLogs); SecurityContextHolder.clearContext(); }
  private String prefix(String resource) { return "admin." + ("slabs".equals(resource) ? "slab-management" : resource.replace("-products", "").equals("finished") ? "finished-stock-management" : "accessory-management"); }
  private String table(String resource) { return "slabs".equals(resource) ? "slab_inventory" : resource.replace('-', '_'); }
  private String logTable(String resource) { return "slabs".equals(resource) ? "slab_operation_logs" : resource.replace("-products", "") + "_operation_logs"; }
  private String logKey(String resource) { return "slabs".equals(resource) ? "slab_id" : "product_id"; }
  private void identity(String client, String scope, List<String> permissions) {
    var actor = new CurrentIdentity(1L,1L,1L,1L,client,null,null,"批量测试",scope,List.of("OPERATOR"),permissions);
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(actor,null,List.of()));
  }
  private void operator(String resource) { String p=prefix(resource); identity("admin","all",List.of(p+".all.view",p+".warehouse.view",p+".selling.view",p+".batch-shelf")); }
  private long asset(String type) {
    return media.upload(new MockMultipartFile("file", type.startsWith("image") ? "test.png" : "test.webm",type,"fixture-content".getBytes(java.nio.charset.StandardCharsets.UTF_8)),1000000).id();
  }
  private long ready(String resource) throws Exception {
    identity("supply-chain","all",List.of("all"));
    ObjectNode payload=json.createObjectNode();
    payload.put("name","批量测试"+COUNTER.incrementAndGet()).put("status","selling").put("supplierId",99090).put("mainImageMediaId",asset("image/png"));
    if ("slabs".equals(resource)) {
      payload.put("serialNo","BATCH-"+COUNTER.incrementAndGet()).put("scanImageMediaId",asset("image/png")).put("designImageMediaId",asset("image/png"));
      for (String ref : List.of("variety","origin","texture","color","grade")) {
        String t="slab_"+ ("variety".equals(ref) ? "varieties" : ref+"s");
        payload.put(ref+"Id",jdbc.queryForObject("SELECT id FROM "+t+" WHERE status='enabled' ORDER BY id DESC LIMIT 1",Long.class));
      }
      payload.put("lengthMm",3000).put("widthMm",1500).put("thicknessMm",20).put("stock",2).put("costPrice",10).put("guidePriceCoefficient",2).put("guidePrice",20);
    } else {
      payload.put("categoryId","finished-products".equals(resource)?99091:99092).put("sku","BATCH-"+COUNTER.incrementAndGet()).put("videoMediaId",asset("video/webm")).put("detail","<p>批量上架资料</p>");
      payload.putArray("attributes"); payload.putArray("markupPrices");
      payload.putArray("variants").addObject().put("variantLabel","单规格").put("displayMode","single").put("stock",2).put("costPrice",10);
    }
    var response=mvc.perform(post("/api/admin/"+resource).contentType("application/json").content(json.writeValueAsBytes(payload))).andExpect(status().isOk()).andReturn().getResponse();
    JsonNode data=json.readTree(response.getContentAsByteArray());
    assertThat(data.path("code").asInt()).as(data.toString()).isZero();
    long id = data.path("data").path("id").asLong();
    if ("slabs".equals(resource)) {
      jdbc.update("UPDATE slab_inventory SET guide_price=20,guide_price_coefficient=2 WHERE id=?",id);
    }
    return id;
  }
  @ParameterizedTest @ValueSource(strings={"finished-products","accessory-products","slabs"})
  void realMixedBatchUsesCurrentSourceAndStateAndContinuesAfterFailure(String resource) throws Exception {
    long good=ready(resource), selling=ready(resource), blocked=ready(resource), invalid=ready(resource), last=ready(resource);
    jdbc.update("UPDATE "+table(resource)+" SET status='selling' WHERE id=?",selling);
    jdbc.update("UPDATE "+table(resource)+" SET source_status='warehouse',source_block_reason='OFF_SHELF' WHERE id=?",blocked);
    if ("slabs".equals(resource)) jdbc.update("UPDATE slab_inventory SET guide_price=NULL WHERE id=?",invalid);
    else jdbc.update("DELETE FROM "+resource.replace("-products", "")+"_product_guide_prices WHERE "+resource.replace("-products", "")+"_product_id=?",invalid);
    operator(resource);
    var response=mvc.perform(post("/api/admin/"+resource+"/batch-shelf").contentType("application/json").content(json.writeValueAsBytes(java.util.Map.of("ids",List.of(good,selling,blocked,invalid,last,good))))).andExpect(status().isOk()).andReturn().getResponse();
    JsonNode result=json.readTree(response.getContentAsByteArray()).path("data");
    assertThat(result.path("total").asInt()).isEqualTo(5);
    assertThat(result.path("successCount").asInt()).as(result.toString()).isEqualTo(2);
    assertThat(result.path("failureCount").asInt()).isEqualTo(3);
    assertThat(result.path("failures").toString()).contains("已处于上架状态，不能重复上架","下架");
    for(long id:List.of(good,last)) {
      assertThat(jdbc.queryForObject("SELECT status FROM "+table(resource)+" WHERE id=?",String.class,id)).isEqualTo("selling");
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM "+logTable(resource)+" WHERE "+logKey(resource)+"=? AND business_client_code='admin' AND operation_type='SHELF'",Long.class,id)).isEqualTo(1L);
    }
    for(long id:List.of(selling,blocked,invalid)) assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM "+logTable(resource)+" WHERE "+logKey(resource)+"=? AND business_client_code='admin' AND operation_type='SHELF'",Long.class,id)).isZero();
    assertThat(jdbc.queryForObject("SELECT status FROM "+table(resource)+" WHERE id=?",String.class,invalid)).isEqualTo("warehouse");
    assertThat(batches.shelf(resource,List.of(good)).failureCount()).isEqualTo(1);
  }
  @ParameterizedTest @ValueSource(strings={"finished-products","accessory-products","slabs"})
  void rejectsMissingGrantOtherClientsAndOutOfScopeRecords(String resource) throws Exception {
    long id=ready(resource);String p=prefix(resource);
    identity("admin","all",List.of(p+".warehouse.view",p+".warehouse.shelf"));
    mvc.perform(post("/api/admin/"+resource+"/batch-shelf").contentType("application/json").content("{\"ids\":["+id+"]}")).andExpect(status().isForbidden());
    for(String client:List.of("supply-chain","store")) {
      identity(client,"all",List.of("all"));
      mvc.perform(post("/api/admin/"+resource+"/batch-shelf").contentType("application/json").content("{\"ids\":["+id+"]}")).andExpect(status().isForbidden());
    }
    identity("admin","self",List.of(p+".warehouse.view",p+".batch-shelf"));
    jdbc.update("UPDATE "+table(resource)+" SET created_by_account_id=2 WHERE id=?",id);
    var failed=batches.shelf(resource,List.of(id));
    assertThat(failed.failures().getFirst().reason()).isEqualTo("商品不存在或无权操作");
    identity("admin","all",List.of(p+".batch-shelf"));
    assertThat(batches.shelf(resource,List.of(id)).failureCount()).isEqualTo(1);
  }
  @Test void simultaneousRequestsCannotShelfOrLogTheSameProductTwice() throws Exception {
    long id = ready("finished-products");
    operator("finished-products");
    var authentication = SecurityContextHolder.getContext().getAuthentication();
    var start = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.Callable<OperationsBatchShelfService.Result> action = () -> {
      try {
        SecurityContextHolder.getContext().setAuthentication(authentication);
        start.await();
        return batches.shelf("finished-products",List.of(id));
      } finally { SecurityContextHolder.clearContext(); }
    };
    try (var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
      var first = executor.submit(action); var second = executor.submit(action); start.countDown();
      var a = first.get(10,java.util.concurrent.TimeUnit.SECONDS); var b = second.get(10,java.util.concurrent.TimeUnit.SECONDS);
      assertThat(a.successCount()+b.successCount()).isEqualTo(1);
      assertThat(a.failureCount()+b.failureCount()).isEqualTo(1);
      assertThat(java.util.stream.Stream.concat(a.failures().stream(),b.failures().stream()).map(OperationsBatchShelfService.Failure::reason))
          .containsExactly("已处于上架状态，不能重复上架");
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=? AND business_client_code='admin' AND operation_type='SHELF'",Long.class,id)).isEqualTo(1L);
  }

  @Test void failingAfterLogWriteRollsBackOnlyThatProduct() throws Exception {
    long bad=ready("finished-products"),good=ready("finished-products");
    doAnswer(invocation -> { invocation.callRealMethod(); throw new IllegalStateException("模拟日志后异常"); }).when(finishedLogs).recordOperation(org.mockito.ArgumentMatchers.argThat(p -> p != null && p.getId().equals(bad)),any(),any(),any());
    operator("finished-products");
    var result=batches.shelf("finished-products",List.of(bad,good));
    assertThat(result.successCount()).isEqualTo(1); assertThat(result.failureCount()).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT status FROM finished_products WHERE id=?",String.class,bad)).isEqualTo("warehouse");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=? AND business_client_code='admin' AND operation_type='SHELF'",Long.class,bad)).isZero();
    assertThat(jdbc.queryForObject("SELECT status FROM finished_products WHERE id=?",String.class,good)).isEqualTo("selling");
  }
}
