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
class ProductAllBatchShelfApiTest extends SpringContainerTestSupport {
  @Container private static final MySQLContainer<?> MYSQL = com.zdm.platform.support.MySqlTestDatabase.create().withDatabaseName("all_batch_shelf").withUsername("test").withPassword("test");
  @DynamicPropertySource static void database(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", MYSQL::getJdbcUrl); r.add("spring.datasource.username", MYSQL::getUsername); r.add("spring.datasource.password", MYSQL::getPassword);
  }
  @Autowired private JdbcTemplate jdbc;
  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper json;
  @Autowired private OperationsBatchShelfService operations;
  @Autowired private ProductAllBatchShelfService batches;
  @Autowired private StoreFinishedProductService storeFinished;
  @Autowired private StoreAccessoryProductService storeAccessory;
  @Autowired private StorePriceRuleService priceRules;
  @Autowired private com.zdm.platform.media.MediaAssetService media;
  @SpyBean private FinishedProductService finishedProducts;
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
  @AfterEach void clear() { reset(finishedProducts); SecurityContextHolder.clearContext(); }
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

  private void storeIdentity(long tenant,long store,List<String> permissions) {
    var actor=new CurrentIdentity(1L,1L,1L,1L,"admin",tenant,store,"门店批量测试","all",List.of("OPERATOR"),permissions);
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(actor,null,List.of()));
  }
  private long sourceReady(String resource) throws Exception {
    long id=ready(resource);
    jdbc.update("UPDATE "+table(resource)+" SET source_status='warehouse' WHERE id=?",id);
    return id;
  }
  private long storeReady(String resource) throws Exception {
    String sourceResource=resource.substring(6),kind=sourceResource.replace("-products","");
    long source=ready(sourceResource);
    operator(sourceResource);
    var shelf=operations.shelf(sourceResource,List.of(source));
    assertThat(shelf.successCount()).as(shelf.toString()).isEqualTo(1);
    jdbc.update("INSERT INTO stores(id,tenant_id,name,type,status,store_level_id) VALUES(99591,1,'批量门店','cityPartner','enabled',99590) ON DUPLICATE KEY UPDATE store_level_id=99590");
    storeIdentity(1,99591,List.of("all"));
    long listing="finished".equals(kind)?storeFinished.select(List.of(source)).getFirst().id():storeAccessory.select(List.of(source)).getFirst().id();
    long category=COUNTER.incrementAndGet();
    jdbc.update("INSERT INTO store_categories(id,store_id,scope,name) VALUES(?,99591,?,?)",category,kind,"批量分类"+category);
    priceRules.savePriceBatch(kind,List.of(category),new java.math.BigDecimal("1.50"));
    long sku=jdbc.queryForObject("SELECT id FROM "+kind+"_product_variants WHERE "+kind+"_product_id=? LIMIT 1",Long.class,source);
    if("finished".equals(kind)) { storeFinished.saveEdit(listing,category,List.of(new StoreFinishedProductService.SalePriceInput(sku,null,"auto",null))); }
    else { storeAccessory.saveEdit(listing,category,List.of(new StoreAccessoryProductService.SalePriceInput(sku,null,"auto",null))); }
    return listing;
  }
  private String terminalPrefix(String resource) { return resource.startsWith("store-")?prefix(resource.substring(6)).replace("admin.","store."):prefix(resource).replace("admin.","supply-chain."); }
  private void batchIdentity(String resource) {
    String p=terminalPrefix(resource);List<String> grants=List.of(p+".all.view",p+".warehouse.view",p+".selling.view",p+".batch-shelf");
    if(resource.startsWith("store-")) { storeIdentity(1,99591,grants); } else { identity("supply-chain","all",grants); }
  }
  private long displayed(String resource,long id) {
    return resource.startsWith("store-")?jdbc.queryForObject("SELECT "+resource.substring(6).replace("-products","")+"_product_id FROM "+resource.replace('-','_')+" WHERE id=?",Long.class,id):id;
  }
  private long shelfLogs(String resource,long id) {
    boolean store=resource.startsWith("store-");String kind=resource.replace("store-","").replace("-products","");
    String table=store?"store_"+kind+"_operation_logs":logTable(resource),key=store?"listing_id":logKey(resource);
    return jdbc.queryForObject("SELECT COUNT(*) FROM "+table+" WHERE "+key+"=? AND operation_type='SHELF'"+(store?"":" AND business_client_code='supply-chain'"),Long.class,id);
  }
  @ParameterizedTest @ValueSource(strings={"finished-products","accessory-products","slabs","store-finished-products","store-accessory-products"})
  void allTabContinuesPerProductWithLiveValidationAndOnlySuccessfulLogs(String resource) throws Exception {
    boolean store=resource.startsWith("store-");
    if(store) { jdbc.execute("ALTER TABLE "+resource.replace('-','_')+" AUTO_INCREMENT=700000"); }
    long good=store?storeReady(resource):sourceReady(resource),selling=store?storeReady(resource):sourceReady(resource),bad=store?storeReady(resource):sourceReady(resource),last=store?storeReady(resource):sourceReady(resource);
    String table=table(resource),state=store?"status":"source_status";
    jdbc.update("UPDATE "+table+" SET "+state+"='selling' WHERE id=?",selling);
    long badDisplay=displayed(resource,bad);
    if(store) { jdbc.update("UPDATE "+table(resource.substring(6))+" SET source_status='warehouse',source_block_reason='OFF_SHELF' WHERE id=?",badDisplay); }
    else { jdbc.update("UPDATE "+table+" SET "+("slabs".equals(resource)?"stock":"total_stock")+"=0 WHERE id=?",bad); }
    long goodBefore=shelfLogs(resource,good),sellingBefore=shelfLogs(resource,selling),badBefore=shelfLogs(resource,bad),lastBefore=shelfLogs(resource,last);
    batchIdentity(resource);
    var response=mvc.perform(post("/api/admin/"+resource+"/all-batch-shelf").contentType("application/json").content(json.writeValueAsBytes(java.util.Map.of("ids",List.of(good,selling,bad,last,good))))).andExpect(status().isOk()).andReturn().getResponse();
    JsonNode result=json.readTree(response.getContentAsByteArray()).path("data");
    assertThat(result.path("total").asInt()).isEqualTo(4);assertThat(result.path("successCount").asInt()).as(result.toString()).isEqualTo(2);assertThat(result.path("failureCount").asInt()).isEqualTo(2);
    assertThat(result.path("failures").toString()).contains("已处于上架状态，不能重复上架");
    assertThat(shelfLogs(resource,good)).isEqualTo(goodBefore+1);assertThat(shelfLogs(resource,last)).isEqualTo(lastBefore+1);
    assertThat(shelfLogs(resource,selling)).isEqualTo(sellingBefore);assertThat(shelfLogs(resource,bad)).isEqualTo(badBefore);
    assertThat(jdbc.queryForObject("SELECT "+state+" FROM "+table+" WHERE id=?",String.class,bad)).isEqualTo("warehouse");
    if(store) {
      assertThat(displayed(resource,selling)).isNotEqualTo(selling);
      assertThat(result.path("failures").get(0).path("id").asLong()).isEqualTo(selling);
      assertThat(result.path("failures").get(1).path("id").asLong()).isEqualTo(bad);
    } else {
      assertThat(jdbc.queryForObject("SELECT status FROM "+table+" WHERE id=?",String.class,good)).isEqualTo("warehouse");
    }
  }
  @ParameterizedTest @ValueSource(strings={"finished-products","accessory-products","slabs","store-finished-products","store-accessory-products"})
  void onlyTheGlobalBatchGrantCanInvokeAllAndStateViewsAreStillRequired(String resource) throws Exception {
    long id=resource.startsWith("store-")?storeReady(resource):sourceReady(resource);String p=terminalPrefix(resource);
    List<String> noBatch=List.of(p+".warehouse.view",p+".warehouse.shelf");
    if(resource.startsWith("store-")) { storeIdentity(1,99591,noBatch); } else { identity("supply-chain","all",noBatch); }
    mvc.perform(post("/api/admin/"+resource+"/all-batch-shelf").contentType("application/json").content("{\"ids\":["+id+"]}")).andExpect(status().isForbidden());
    if(resource.startsWith("store-")) { storeIdentity(1,99591,List.of(p+".batch-shelf")); } else { identity("supply-chain","all",List.of(p+".batch-shelf")); }
    assertThat(batches.shelf(resource,List.of(id)).failures().getFirst().reason()).isEqualTo("商品不存在或无权操作");
    identity("admin","all",List.of("all"));
    mvc.perform(post("/api/admin/"+resource+"/all-batch-shelf").contentType("application/json").content("{\"ids\":["+id+"]}")).andExpect(status().isForbidden());
  }
  @ParameterizedTest @ValueSource(strings={"store-finished-products","store-accessory-products"})
  void storeRequestsCannotCrossStoreOrTenantAndDoNotExposeSourceIds(String resource) throws Exception {
    long id=storeReady(resource);String p=terminalPrefix(resource);
    jdbc.update("INSERT IGNORE INTO accounts(id,phone,display_name,status) VALUES(99593,'15900009999','批量另一租户','enabled')");
    jdbc.update("INSERT IGNORE INTO tenants(id,account_id,status,business_types) VALUES(2,99593,'enabled','cityPartner')");
    jdbc.update("INSERT IGNORE INTO stores(id,tenant_id,name,type,status) VALUES(99592,1,'其他门店','cityPartner','enabled'),(99593,2,'其他租户门店','cityPartner','enabled')");
    for(long store:List.of(99592L,99593L)) {
      storeIdentity(store==99592?1:2,store,List.of(p+".warehouse.view",p+".batch-shelf"));
      var result=batches.shelf(resource,List.of(id));assertThat(result.successCount()).isZero();
      assertThat(result.failures().getFirst().id()).isEqualTo(id);assertThat(result.failures().getFirst().reason()).isEqualTo("商品不存在或无权操作");
    }
  }
  @ParameterizedTest @ValueSource(strings={"finished-products","store-finished-products"})
  void concurrentAllRequestsDoNotShelfOrLogTwice(String resource) throws Exception {
    long id=resource.startsWith("store-")?storeReady(resource):sourceReady(resource);
    long before=shelfLogs(resource,id);batchIdentity(resource);
    var actor=SecurityContextHolder.getContext().getAuthentication();var start=new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.Callable<OperationsBatchShelfService.Result> action=() -> {
      try { SecurityContextHolder.getContext().setAuthentication(actor);start.await();return batches.shelf(resource,List.of(id)); }
      finally { SecurityContextHolder.clearContext(); }
    };
    try(var executor=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
      var first=executor.submit(action);var second=executor.submit(action);start.countDown();
      var a=first.get(10,java.util.concurrent.TimeUnit.SECONDS);var b=second.get(10,java.util.concurrent.TimeUnit.SECONDS);
      assertThat(a.successCount()+b.successCount()).isEqualTo(1);assertThat(a.failureCount()+b.failureCount()).isEqualTo(1);
      assertThat(java.util.stream.Stream.concat(a.failures().stream(),b.failures().stream()).map(OperationsBatchShelfService.Failure::reason))
          .containsExactly("已处于上架状态，不能重复上架");
    }
    assertThat(shelfLogs(resource,id)).isEqualTo(before+1);
  }

  @ParameterizedTest @ValueSource(strings={"finished-products","accessory-products","slabs","store-finished-products","store-accessory-products"})
  void warehouseOriginalEndpointsAcceptGlobalBatchPermission(String resource) throws Exception {
    boolean store=resource.startsWith("store-");long id=store?storeReady(resource):sourceReady(resource);batchIdentity(resource);
    long before=shelfLogs(resource,id);String path;JsonNode payload;
    if(store) { path="/api/admin/"+resource+"/status/batch";payload=json.valueToTree(java.util.Map.of("ids",List.of(id),"target","selling")); }
    else if("slabs".equals(resource)) { path="/api/admin/slabs/batch-status";payload=json.valueToTree(java.util.Map.of("ids",List.of(id),"status","selling")); }
    else {
      path="/api/admin/"+resource+"/"+id;
      ObjectNode product=json.valueToTree("finished-products".equals(resource)?finishedProducts.getById(id):jdbc.queryForMap("SELECT * FROM accessory_products WHERE id=?",id));
      product.put("name","原仓库权限验证").put("status","selling");payload=product;
    }
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(path).contentType("application/json").content(json.writeValueAsBytes(payload))).andExpect(status().isOk());
    assertThat(shelfLogs(resource,id)).isEqualTo(before+1);
  }
  @ParameterizedTest @ValueSource(strings={"finished-products","accessory-products","slabs"})
  void sourceAllRejectsRecordsOutsideCreatorDataScope(String resource) throws Exception {
    long id=sourceReady(resource);long before=shelfLogs(resource,id);String p=terminalPrefix(resource);
    jdbc.update("UPDATE "+table(resource)+" SET created_by_account_id=2 WHERE id=?",id);
    identity("supply-chain","self",List.of(p+".warehouse.view",p+".batch-shelf"));
    var result=batches.shelf(resource,List.of(id));assertThat(result.successCount()).isZero();
    assertThat(result.failures().getFirst().reason()).isEqualTo("商品不存在或无权操作");
    assertThat(shelfLogs(resource,id)).isEqualTo(before);
  }

  @Test void exceptionAfterSourceShelfRollsBackThatProductAndKeepsFollowingProduct() throws Exception {
    long bad=sourceReady("finished-products"),good=sourceReady("finished-products");long before=shelfLogs("finished-products",bad);
    doAnswer(invocation -> { invocation.callRealMethod(); throw new IllegalStateException("模拟上架后异常"); }).when(finishedProducts).sourceTransition(org.mockito.ArgumentMatchers.eq(bad),any(),any(),any());
    batchIdentity("finished-products");var result=batches.shelf("finished-products",List.of(bad,good));
    assertThat(result.successCount()).isEqualTo(1);assertThat(result.failureCount()).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT source_status FROM finished_products WHERE id=?",String.class,bad)).isEqualTo("warehouse");
    assertThat(shelfLogs("finished-products",bad)).isEqualTo(before);
  }
}
