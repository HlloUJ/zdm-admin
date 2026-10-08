package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.support.SpringContainerTestSupport;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@Testcontainers(disabledWithoutDocker = true)
class StoreFinishedProductServiceTest extends SpringContainerTestSupport {
  @Container private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("store_finished_test").withUsername("zdm_admin").withPassword("zdm_admin_pwd");
  @Autowired private JdbcTemplate jdbc;
  @Autowired private StoreFinishedProductService products;
  @Autowired private StoreFinishedPriceConfigurationService configurations;
  @Autowired private ProductLifecycleService lifecycle;
  @Autowired private StoreFinishedUpstreamLogService upstreamLogs;
  @Autowired private FinishedProductService finishedProducts;
  @Autowired private MockMvc mvc;
  @Autowired private org.mybatis.spring.SqlSessionTemplate sqlSession;

  @DynamicPropertySource
  static void datasource(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
  }

  @AfterEach
  void clearIdentity() {
    SecurityContextHolder.clearContext();
  }

  @Test
  @Transactional
  void poolPricesAndReadOnlyDetailsUseOnlyCurrentStoreLevel() throws Exception {
    jdbc.update("INSERT INTO store_levels (id,name,sort_order) VALUES (99751,'商品中心甲级',1),(99752,'商品中心乙级',2)");
    jdbc.update("INSERT INTO stores (id,tenant_id,name,type,store_level_id,status) "
        + "VALUES (99751,1,'商品中心甲店','cityPartner',99751,'enabled'),"
        + "(99752,1,'商品中心乙店','cityPartner',99752,'enabled')");
    jdbc.update("INSERT INTO finished_products (id,name,sku,total_stock,status,source_status,operations_deleted) "
        + "VALUES (99751,'商品中心商品','pool-price-test',5,'selling','selling',FALSE)");
    jdbc.update("INSERT INTO finished_product_variants (id,finished_product_id,variant_label,stock,cost_price) "
        + "VALUES (99751,99751,'规格 A',2,17),(99752,99751,'规格 B',3,19)");
    jdbc.update("INSERT INTO finished_product_prices "
        + "(finished_product_id,sku_id,variant_label,store_level_id,store_level_name,price_coefficient,cost_price,price,price_source) "
        + "VALUES (99751,99751,'规格 A',99751,'商品中心甲级',1,17,100,'manual'),"
        + "(99751,99752,'规格 B',99751,'商品中心甲级',1,19,120,'manual'),"
        + "(99751,99751,'规格 A',99752,'商品中心乙级',1,17,200,'manual')");
    jdbc.update("INSERT INTO finished_product_guide_prices "
        + "(finished_product_id,sku_id,variant_label,price_coefficient,cost_price,price) "
        + "VALUES (99751,99751,'规格 A',1,17,300),(99751,99752,'规格 B',1,19,350)");
    jdbc.update("INSERT INTO product_categories (id,name,scope,parent_id) VALUES "
        + "(99751,'商品中心测试家具','finished',NULL),(99752,'桌椅','finished',99751),(99753,'餐桌','finished',99752)");
    jdbc.update("UPDATE finished_products SET category_id=99753 WHERE id=99751");
    jdbc.update("INSERT INTO product_attributes (id,name,scope,value_type,attribute_role) VALUES "
        + "(99751,'销售纹理','shared','text','sales'),(99752,'表面工艺','finished','text','sales')");
    jdbc.update("UPDATE finished_product_variants SET sales_attributes=JSON_OBJECT("
        + "'attribute_99751','纹理 A','attribute_99752','光面') WHERE id=99751");
    jdbc.update("INSERT INTO product_categories (id,name,scope,status,tenant_id) VALUES "
        + "(99754,'停用分类','finished','disabled',NULL),(99755,'门店私有分类','finished','enabled',1),"
        + "(99756,'大板分类','slab','enabled',NULL),(99757,'已删除分类','finished','enabled',NULL)");
    jdbc.update("DELETE FROM product_categories WHERE id=99757");
    identityWithPermissions(99751L, "store.finished-stock-management.warehouse.view");
    mvc.perform(get("/api/admin/store-finished-products/categories"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.id == 99753)].name").value(org.hamcrest.Matchers.hasItem("餐桌")))
        .andExpect(jsonPath("$.data[?(@.id == 99754)]").isEmpty())
        .andExpect(jsonPath("$.data[?(@.id == 99755)]").isEmpty())
        .andExpect(jsonPath("$.data[?(@.id == 99756)]").isEmpty())
        .andExpect(jsonPath("$.data[?(@.id == 99757)]").isEmpty());
    identityWithPermissions(99751L);
    mvc.perform(get("/api/admin/store-finished-products/categories"))
        .andExpect(status().isForbidden());
    identityWithPermissions(99751L, "store.finished-stock-management.warehouse.select");
    mvc.perform(get("/api/admin/store-finished-products/pool-categories"))
        .andExpect(status().isOk());
    assertThat(products.poolCategories()).filteredOn(item -> item.id() == 99753L)
        .singleElement().satisfies(item -> {
          assertThat(item.parentId()).isEqualTo(99752L);
          assertThat(item.name()).isEqualTo("餐桌");
        });
    var candidate = products.pool().stream().filter(item -> item.id() == 99751L).findFirst().orElseThrow();
    assertThat(candidate.storeLevelName()).isEqualTo("商品中心甲级");
    assertThat(candidate.guidePriceMin()).isEqualByComparingTo("300");
    assertThat(candidate.guidePriceMax()).isEqualByComparingTo("350");
    assertThat(candidate.partnerPriceMin()).isEqualByComparingTo("100");
    assertThat(candidate.partnerPriceMax()).isEqualByComparingTo("120");
    mvc.perform(get("/api/admin/store-finished-products/pool/99751?storeId=99752&storeLevelId=99752"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.categoryName").value("商品中心测试家具 / 桌椅 / 餐桌"))
        .andExpect(jsonPath("$.data.storeLevelName").value("商品中心甲级"))
        .andExpect(jsonPath("$.data.attributeNames.attribute_99751").value("销售纹理"))
        .andExpect(jsonPath("$.data.attributeNames.attribute_99752").value("表面工艺"))
        .andExpect(jsonPath("$.data.skus[0].partnerPrice").value(100))
        .andExpect(jsonPath("$.data.skus[0].guidePrice").value(300))
        .andExpect(jsonPath("$.data.skus[0].costPrice").doesNotExist())
        .andExpect(jsonPath("$.data.skus[0].priceCoefficient").doesNotExist())
        .andExpect(jsonPath("$.data.markupPrices").doesNotExist());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_finished_products WHERE finished_product_id=99751", Long.class)).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_finished_operation_logs WHERE finished_product_id=99751", Long.class)).isZero();

    identityWithPermissions(99752L, "store.finished-stock-management.warehouse.select");
    mvc.perform(get("/api/admin/store-finished-products/pool/99751"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.storeLevelName").value("商品中心乙级"))
        .andExpect(jsonPath("$.data.skus[0].partnerPrice").value(200))
        .andExpect(jsonPath("$.data.skus[1].partnerPrice").isEmpty());
    jdbc.update("UPDATE store_levels SET name='商品中心新级别名' WHERE id=99752");
    assertThat(products.poolDetail(99751L).storeLevelName()).isEqualTo("商品中心新级别名");
    assertThat(products.pool()).filteredOn(item -> item.id() == 99751L)
        .allSatisfy(item -> assertThat(item.storeLevelName()).isEqualTo("商品中心新级别名"));
    jdbc.update("UPDATE stores SET store_level_id=NULL WHERE id=99752");
    assertThat(products.poolDetail(99751L).storeLevelName()).isNull();
    assertThat(products.pool()).filteredOn(item -> item.id() == 99751L)
        .allSatisfy(item -> assertThat(item.storeLevelName()).isNull());
    assertThat(products.poolDetail(99751L).skus()).allSatisfy(sku -> assertThat(sku.partnerPrice()).isNull());
    identityWithPermissions(99752L, "store.finished-stock-management.warehouse.view");
    mvc.perform(get("/api/admin/store-finished-products/pool/99751")).andExpect(status().isForbidden());
    mvc.perform(get("/api/admin/store-finished-products/pool-categories")).andExpect(status().isForbidden());
    upstreamIdentity("supply-chain");
    assertThatThrownBy(() -> products.listCategories()).isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    assertThatThrownBy(() -> products.poolCategories()).isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    assertThatThrownBy(() -> products.poolDetail(99751L)).isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    identityWithPermissions(99751L, "store.finished-stock-management.warehouse.select");
    jdbc.update("UPDATE finished_products SET detail='<p>挑选时图文</p>' WHERE id=99751");
    jdbc.update("INSERT INTO media_assets (id,public_id,storage_key,media_type,mime_type,owner_client_code) VALUES "
        + "(99751,UUID(),'store-snapshot-image','image','image/png','supply-chain'),"
        + "(99752,UUID(),'store-snapshot-video','video','video/mp4','supply-chain')");
    jdbc.update("INSERT INTO media_references (media_id,business_domain,business_id,field_key,owner_client_code) VALUES "
        + "(99751,'FINISHED_PRODUCT',99751,'mainImage','supply-chain'),"
        + "(99752,'FINISHED_PRODUCT',99751,'video','supply-chain')");
    var json = new com.fasterxml.jackson.databind.ObjectMapper();
    assertThat(json.writeValueAsString(products.pool())).doesNotContain("supplier");
    assertThat(json.writeValueAsString(products.poolDetail(99751L))).doesNotContain("supplier");
    var selectedProduct = products.select(List.of(99751L)).getFirst();
    assertThat(selectedProduct.createdByName()).isEqualTo("门店测试员工");
    assertThat(selectedProduct.createdAt()).isNotNull().isEqualTo(jdbc.queryForObject(
        "SELECT created_at FROM store_finished_products WHERE id=?", java.time.LocalDateTime.class, selectedProduct.id()));
    var listedProduct = products.list().stream().filter(item -> item.id().equals(selectedProduct.id())).findFirst().orElseThrow();
    assertThat(listedProduct.createdByName()).isEqualTo("门店测试员工");
    assertThat(listedProduct.createdAt()).isEqualTo(selectedProduct.createdAt());
    var viewJson = new com.fasterxml.jackson.databind.ObjectMapper().findAndRegisterModules();
    assertThat(viewJson.writeValueAsString(selectedProduct)).doesNotContain("supplier");
    assertThat(viewJson.writeValueAsString(products.list())).doesNotContain("supplier");
    Long logId = jdbc.queryForObject("SELECT id FROM store_finished_operation_logs WHERE finished_product_id=99751 AND operation_type='SELECT'", Long.class);
    String captured = jdbc.queryForObject("SELECT change_details FROM store_finished_operation_logs WHERE id=?", String.class, logId);
    var snapshot = new com.fasterxml.jackson.databind.ObjectMapper().readTree(captured);
    assertThat(snapshot.path("商品名称").asText()).isEqualTo("商品中心商品");
    assertThat(snapshot.path("商品分类").asText()).isEqualTo("商品中心测试家具 / 桌椅 / 餐桌");
    assertThat(snapshot.path("销售属性名称").path("attribute_99751").asText()).isEqualTo("销售纹理");
    assertThat(snapshot.path("销售规格").get(0).path("stock").asInt()).isEqualTo(2);
    assertThat(snapshot.path("指导价").get(0).path("price").decimalValue()).isEqualByComparingTo("300");
    assertThat(snapshot.path("层级价格").get(0).path("price").decimalValue()).isEqualByComparingTo("100");
    assertThat(snapshot.path("层级价格")).hasSize(2);
    assertThat(captured).doesNotContain("costPrice", "cost_price", "priceCoefficient", "商品中心乙级", "供应商", "supplier");
    assertThat(snapshot.path("宝贝详情").asText()).isEqualTo("<p>挑选时图文</p>");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE business_domain='STORE_FINISHED_PRODUCT_LOG' AND business_id=? AND reference_kind='HISTORY'", Long.class, logId)).isEqualTo(2);
    jdbc.update("UPDATE finished_products SET name='后来改名',detail='后来详情' WHERE id=99751");
    jdbc.update("UPDATE product_categories SET name='后来分类' WHERE id=99753");
    jdbc.update("UPDATE product_attributes SET name='后来属性' WHERE id=99751");
    jdbc.update("UPDATE store_levels SET name='后来级别' WHERE id=99751");
    jdbc.update("UPDATE finished_product_prices SET price=999 WHERE finished_product_id=99751");
    jdbc.update("DELETE FROM media_references WHERE business_domain='FINISHED_PRODUCT' AND business_id=99751");
    String historical = products.logDetail(logId).changeDetails();
    assertThat(historical).contains("商品中心商品", "商品中心甲级", "餐桌", "销售纹理", "挑选时图文")
        .doesNotContain("后来", "999", "costPrice", "priceCoefficient");
    assertThat(jdbc.queryForObject("SELECT change_details FROM store_finished_operation_logs WHERE id=?", String.class, logId)).isEqualTo(captured);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE business_domain='STORE_FINISHED_PRODUCT_LOG' AND business_id=?", Long.class, logId)).isEqualTo(2);
    jdbc.update("UPDATE store_finished_operation_logs SET change_details=JSON_SET(change_details, '$.供应商', '历史供应商', '$.supplierId', 777) WHERE id=?", logId);
    assertThat(products.logDetail(logId).changeDetails()).doesNotContain("供应商", "supplier", "历史供应商");
    assertThat(products.logs().stream().filter(item -> item.id().equals(logId)).findFirst().orElseThrow().changeDetails())
        .doesNotContain("供应商", "supplier", "历史供应商");
    assertThat(products.logPage(null, null, null, null, null, 1, 10).records().stream()
        .filter(item -> item.id().equals(logId)).findFirst().orElseThrow().changeDetails())
        .doesNotContain("供应商", "supplier", "历史供应商");
    assertThat(jdbc.queryForObject("SELECT change_details FROM store_finished_operation_logs WHERE id=?", String.class, logId))
        .contains("历史供应商");
    identityWithPermissions(99752L, "store.finished-stock-management.operation-log.view");
    assertThatThrownBy(() -> products.logDetail(logId)).isInstanceOf(IllegalArgumentException.class);
    identityWithPermissions(99751L, "store.finished-stock-management.warehouse.select");
    assertThatThrownBy(() -> products.poolDetail(99751L)).isInstanceOf(IllegalArgumentException.class);
    identityWithPermissions(99752L, "store.finished-stock-management.warehouse.select");
    assertThat(products.poolDetail(99751L).id()).isEqualTo(99751L);
    jdbc.update("UPDATE finished_products SET status='offShelf' WHERE id=99751");
    assertThatThrownBy(() -> products.poolDetail(99751L)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  @Transactional
  void poolQueriesStayBoundedAsProductsGrow() {
    jdbc.update("INSERT INTO stores (id,tenant_id,name,type,status) VALUES (99871,1,'商品池测试门店','cityPartner','enabled')");
    jdbc.update("INSERT INTO finished_products (id,name,total_stock,status,source_status,operations_deleted) "
        + "VALUES (99871,'候选商品一',2,'selling','selling',FALSE)");
    identity(99871L);

    sqlSession.clearCache();
    long beforeOne = selectCount();
    assertThat(products.pool()).extracting(StoreFinishedProductService.PoolProduct::id).contains(99871L);
    long one = selectCount() - beforeOne;

    jdbc.update("INSERT INTO finished_products (id,name,total_stock,status,source_status,operations_deleted) "
        + "VALUES (99872,'候选商品二',2,'selling','selling',FALSE),"
        + "(99873,'候选商品三',2,'selling','selling',FALSE)");
    sqlSession.clearCache();
    long beforeThree = selectCount();
    assertThat(products.pool()).extracting(StoreFinishedProductService.PoolProduct::id)
        .contains(99871L, 99872L, 99873L);
    long three = selectCount() - beforeThree;

    System.out.printf("store finished pool SELECT count: one=%d, three=%d%n", one, three);
    assertThat(three).withFailMessage("pool SELECT count: one=%d, three=%d", one, three)
        .isLessThanOrEqualTo(one + 2);
  }

  @Test
  @Transactional
  void listUsesBoundedQueriesAndMatchesIndividualDetails() {
    jdbc.update("INSERT INTO store_levels (id,name,sort_order) VALUES (99861,'列表测试级别',1)");
    jdbc.update("INSERT INTO stores (id,tenant_id,name,type,store_level_id,status) "
        + "VALUES (99861,1,'列表测试门店','cityPartner',99861,'enabled')");
    jdbc.update("INSERT INTO roles (id,tenant_id,store_id,client_code,name,code,status) "
        + "VALUES (99861,1,99861,'admin','列表角色','STORE_LIST_TEST','enabled')");
    jdbc.update("INSERT INTO suppliers (id,name,owner_scope,owner_id) "
        + "VALUES (99861,'列表供应商','platform',0)");
    jdbc.update("INSERT INTO product_categories (id,name,scope) VALUES (99861,'列表分类','finished')");
    jdbc.update("INSERT INTO store_finished_role_price_configurations "
        + "(tenant_id,store_id,role_id,price_coefficient,status,created_by_account_id) "
        + "VALUES (1,99861,99861,1.2,'enabled',1)");
    jdbc.update("INSERT INTO product_categories (id,name,scope,parent_id) VALUES (99860,'上级分类','finished',NULL)");
    jdbc.update("UPDATE product_categories SET parent_id=99860 WHERE id=99861");
    jdbc.update("INSERT INTO product_attributes (id,name,scope,value_type,attribute_role) VALUES (99861,'销售纹理','shared','text','sales')");
    insertListProduct(99861L);
    jdbc.update("UPDATE finished_product_variants SET sales_attributes=JSON_OBJECT('attribute_99861','纹理 A') WHERE finished_product_id=99861");
    identity(99861L);

    sqlSession.clearCache();
    long beforeOne = selectCount();
    var oneProduct = products.list();
    long one = selectCount() - beforeOne;
    assertThat(oneProduct).hasSize(1);
    assertThat(oneProduct.getFirst().categoryName()).isEqualTo("上级分类 / 列表分类");
    assertThat(oneProduct.getFirst().storeLevelName()).isEqualTo("列表测试级别");
    assertThat(oneProduct.getFirst().attributeNames()).containsEntry("attribute_99861", "销售纹理");
    assertThat(oneProduct.getFirst()).isEqualTo(products.detail(99861L));

    insertListProduct(99862L);
    insertListProduct(99863L);
    jdbc.update("INSERT INTO store_finished_role_price_overrides "
        + "(listing_id,sku_id,role_id,manual_price,updated_by_account_id) "
        + "VALUES (99862,99872,99861,75,1)");
    sqlSession.clearCache();
    long beforeThree = selectCount();
    var threeProducts = products.list();
    long three = selectCount() - beforeThree;
    assertThat(threeProducts).hasSize(3);
    for (var product : threeProducts) {
      assertThat(product).isEqualTo(products.detail(product.id()));
    }
    System.out.printf("store finished list SELECT count: one=%d, three=%d%n", one, three);
    assertThat(three).withFailMessage("store list SELECT count: one=%d, three=%d", one, three)
        .isLessThanOrEqualTo(one + 2);
  }

  private void insertListProduct(long id) {
    long skuId = id + 10;
    jdbc.update("INSERT INTO finished_products "
        + "(id,name,sku,supplier_id,category_id,total_stock,status,source_status,operations_deleted) "
        + "VALUES (?,'列表商品',?,99861,99861,2,'selling','selling',FALSE)", id, "list-" + id);
    jdbc.update("INSERT INTO finished_product_variants "
        + "(id,finished_product_id,variant_label,stock,cost_price) "
        + "VALUES (?,?,'规格 A',2,60)", skuId, id);
    jdbc.update("INSERT INTO finished_product_prices "
        + "(finished_product_id,sku_id,variant_label,store_level_id,store_level_name,"
        + "price_coefficient,cost_price,price,price_source) "
        + "VALUES (?,?,'规格 A',99861,'列表测试级别',1,60,100,'manual')", id, skuId);
    jdbc.update("INSERT INTO finished_product_guide_prices "
        + "(finished_product_id,sku_id,variant_label,price_coefficient,cost_price,price) "
        + "VALUES (?,?,'规格 A',1,60,150)", id, skuId);
    jdbc.update("INSERT INTO store_finished_products "
        + "(id,tenant_id,store_id,finished_product_id,status,selected_by_account_id) "
        + "VALUES (?,1,99861,?,'warehouse',1)", id, id);
  }

  private long selectCount() {
    return jdbc.queryForObject("SHOW SESSION STATUS LIKE 'Com_select'", (row, index) -> row.getLong("Value"));
  }

  @Test
  @Transactional
  void unavailableDetailsUseVisibleTabGrantWithoutChangingOrdinaryDetails() throws Exception {
    jdbc.update("INSERT INTO stores (id,tenant_id,name,type,status) VALUES (99861,1,'详情权限门店','cityPartner','enabled'),(99862,1,'其他门店','cityPartner','enabled')");
    jdbc.update("INSERT INTO finished_products (id,name,total_stock,status,source_status,operations_deleted) VALUES (99861,'详情权限商品',1,'selling','selling',FALSE)");
    jdbc.update("INSERT INTO store_finished_products (id,tenant_id,store_id,finished_product_id,status,selected_by_account_id) VALUES (99861,1,99861,99861,'warehouse',1)");
    for (String tab : List.of("warehouse", "selling", "offShelf", "soldOut", "recycle")) {
      String scope = switch (tab) {
        case "offShelf" -> "off-shelf";
        case "soldOut" -> "sold-out";
        default -> tab;
      };
      jdbc.update("UPDATE store_finished_products SET status=? WHERE id=99861",
          "soldOut".equals(tab) ? "selling" : tab);
      jdbc.update("UPDATE finished_products SET total_stock=? WHERE id=99861", "soldOut".equals(tab) ? 0 : 1);
      for (String upstream : List.of("source_status", "status")) {
        jdbc.update("UPDATE finished_products SET status='selling',source_status='selling' WHERE id=99861");
        if ("source_status".equals(upstream)) {
          jdbc.update("UPDATE finished_products SET source_status='offShelf' WHERE id=99861");
        } else {
          jdbc.update("UPDATE finished_products SET status='offShelf' WHERE id=99861");
        }
        identityWithPermissions(99861L, "store.finished-stock-management." + scope + ".view");
        mvc.perform(get("/api/admin/store-finished-products/99861"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.sourceUnavailable").value(true));
        identityWithPermissions(99861L, "store.finished-stock-management.operation-log.view");
        mvc.perform(get("/api/admin/store-finished-products/99861")).andExpect(status().isForbidden());
      }
      jdbc.update("UPDATE finished_products SET status='selling',source_status='selling' WHERE id=99861");
      identityWithPermissions(99861L, "store.finished-stock-management." + scope + ".view");
      mvc.perform(get("/api/admin/store-finished-products/99861")).andExpect(status().isForbidden());
      String action = List.of("warehouse", "selling").contains(tab) ? "edit" : "detail";
      identityWithPermissions(99861L, "store.finished-stock-management." + scope + ".view",
          "store.finished-stock-management." + scope + "." + action);
      mvc.perform(get("/api/admin/store-finished-products/99861")).andExpect(status().isOk());
    }
    jdbc.update("UPDATE finished_products SET source_status='offShelf' WHERE id=99861");
    identityWithPermissions(99862L, "store.finished-stock-management.recycle.view");
    assertThatThrownBy(() -> products.detail(99861L)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  @Transactional
  void unavailablePurgeUsesVisibleTabGrantWhileOrdinaryRecycleStillNeedsPurgeGrant() throws Exception {
    jdbc.update("INSERT INTO stores (id,tenant_id,name,type,status) VALUES (99851,1,'权限测试门店','cityPartner','enabled')");
    jdbc.update("INSERT INTO finished_products (id,name,total_stock,status,source_status,operations_deleted) VALUES (99851,'不可用商品',1,'selling','offShelf',FALSE),(99852,'正常商品',1,'selling','selling',FALSE)");
    jdbc.update("INSERT INTO store_finished_products (id,tenant_id,store_id,finished_product_id,status,selected_by_account_id) VALUES (99851,1,99851,99851,'selling',1),(99852,1,99851,99852,'recycle',1)");

    identityWithPermissions(99851L, "store.finished-stock-management.operation-log.view");
    mvc.perform(delete("/api/admin/store-finished-products/99851")).andExpect(status().isForbidden());
    identityWithPermissions(99851L, "store.finished-stock-management.warehouse.view");
    mvc.perform(delete("/api/admin/store-finished-products/99851")).andExpect(status().isForbidden());
    identityWithPermissions(99851L, "store.finished-stock-management.selling.view");
    mvc.perform(delete("/api/admin/store-finished-products/99851")).andExpect(status().isOk());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_finished_products WHERE id=99851", Long.class)).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_finished_operation_logs WHERE listing_id=99851 AND operation_type='PURGE'", Long.class)).isEqualTo(1);

    identityWithPermissions(99851L, "store.finished-stock-management.recycle.view");
    mvc.perform(delete("/api/admin/store-finished-products/99852")).andExpect(status().isForbidden());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_finished_products WHERE id=99852", Long.class)).isEqualTo(1);
  }

  @Test
  void storeSelectionPricesAndUpstreamStateStayScopedToItsStore() {
    jdbc.update("INSERT INTO store_levels (id,name,sort_order) VALUES (99801,'门店成品测试级别',1)");
    jdbc.update("INSERT INTO stores (id,tenant_id,name,type,store_level_id,status) VALUES (99801,1,'门店成品测试甲','cityPartner',99801,'enabled'),(99802,1,'门店成品测试乙','cityPartner',99801,'enabled')");
    jdbc.update("INSERT INTO roles (id,tenant_id,store_id,client_code,name,code,status) VALUES (99801,1,99801,'admin','店长','STORE_FINISHED_MANAGER','enabled'),(99802,1,99801,'admin','导购','STORE_FINISHED_GUIDE','enabled')");
    jdbc.update("INSERT INTO account_roles (account_id,role_id,client_code,tenant_id,store_id) VALUES (1,99801,'admin',1,99801),(1,99802,'admin',1,99801)");
    jdbc.update("INSERT INTO finished_products (id,name,sku,total_stock,status,source_status,operations_deleted) VALUES (99801,'共享成品','store-finished-test',3,'selling','selling',FALSE)");
    jdbc.update("INSERT INTO finished_product_variants (id,finished_product_id,variant_label,stock,cost_price) VALUES (99811,99801,'规格 A',3,60)");
    jdbc.update("INSERT INTO finished_product_prices (finished_product_id,sku_id,variant_label,store_level_id,store_level_name,price_coefficient,cost_price,price,price_source) VALUES (99801,99811,'规格 A',99801,'门店成品测试级别',1,60,100,'manual')");
    jdbc.update("INSERT INTO finished_product_guide_prices (finished_product_id,sku_id,variant_label,price_coefficient,cost_price,price) VALUES (99801,99811,'规格 A',1,60,150)");

    identity(99801L);
    assertThat(products.pool()).extracting(StoreFinishedProductService.PoolProduct::id).contains(99801L);
    long listingId = products.select(List.of(99801L)).getFirst().id();
    assertThat(products.pool()).isEmpty();
    assertThat(products.detail(listingId).skus().getFirst().costPrice()).isEqualByComparingTo("100");
    configurations.create(99801L, new BigDecimal("1.2000"));
    configurations.create(99802L, new BigDecimal("0.8000"));
    assertThat(products.currentEmployeeMinimumPrice(listingId, 99811L).price()).isEqualByComparingTo("80.00");
    products.saveRolePrice(listingId, 99811L, 99801L, new BigDecimal("50"), false);
    assertThat(products.currentEmployeeMinimumPrice(listingId, 99811L).price()).isEqualByComparingTo("50");
    assertThat(products.currentEmployeeMinimumPrice(listingId, 99811L).roleId()).isEqualTo(99801L);
    jdbc.update("UPDATE finished_product_prices SET price=200 WHERE finished_product_id=99801");
    jdbc.update("UPDATE finished_product_guide_prices SET price=170 WHERE finished_product_id=99801");
    var repriced = products.detail(listingId).skus().getFirst();
    assertThat(repriced.costPrice()).isEqualByComparingTo("200");
    assertThat(repriced.guidePrice()).isEqualByComparingTo("170");
    assertThat(repriced.rolePrices().stream().filter(item -> item.roleId() == 99802L).findFirst().orElseThrow().price())
        .isEqualByComparingTo("160.00");
    assertThat(products.currentEmployeeMinimumPrice(listingId, 99811L).price()).isEqualByComparingTo("50");
    products.changeStatus(listingId, "selling", null, null);
    jdbc.update("UPDATE finished_products SET source_status='offShelf' WHERE id=99801");
    assertThat(products.detail(listingId).sourceUnavailable()).isTrue();
    assertThatThrownBy(() -> products.changeStatus(listingId, "offShelf", "其他", null))
        .isInstanceOf(IllegalArgumentException.class);
    for (String sourceStatus : List.of("offShelf", "recycle", "purged", "warehouse")) {
      jdbc.update("UPDATE finished_products SET source_status=? WHERE id=99801", sourceStatus);
      assertThat(products.detail(listingId).sourceUnavailable()).isTrue();
      assertThatThrownBy(() -> products.changeStatusBatch(List.of(listingId), "offShelf", "其他", null))
          .isInstanceOf(IllegalArgumentException.class);
      assertThatThrownBy(() -> products.saveRolePrice(listingId, 99811L, 99801L, new BigDecimal("50"), false))
          .isInstanceOf(IllegalArgumentException.class);
    }
    jdbc.update("UPDATE finished_products SET source_status='selling' WHERE id=99801");
    for (String operationsStatus : List.of("warehouse", "offShelf", "recycle")) {
      jdbc.update("UPDATE finished_products SET status=? WHERE id=99801", operationsStatus);
      assertThat(products.detail(listingId).sourceUnavailable()).isTrue();
      assertThatThrownBy(() -> products.changeStatus(listingId, "offShelf", "其他", null))
          .isInstanceOf(IllegalArgumentException.class);
    }
    jdbc.update("UPDATE finished_products SET status='selling',operations_deleted=TRUE WHERE id=99801");
    assertThat(products.detail(listingId).sourceUnavailable()).isTrue();
    assertThatThrownBy(() -> products.changeStatus(listingId, "offShelf", "其他", null))
        .isInstanceOf(IllegalArgumentException.class);
    jdbc.update("UPDATE finished_products SET operations_deleted=FALSE WHERE id=99801");
    assertThat(products.detail(listingId).status()).isEqualTo("selling");
    jdbc.update("UPDATE finished_products SET total_stock=0 WHERE id=99801");
    assertThat(products.detail(listingId).effectiveStatus()).isEqualTo("soldOut");
    assertThat(products.logs()).isNotEmpty();

    identity(99802L);
    assertThat(products.list()).isEmpty();
    assertThatThrownBy(() -> products.detail(listingId)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void republishedProductKeepsInvalidSelectionVisibleUntilStorePurgesIt() {
    jdbc.update("INSERT INTO store_levels (id,name,sort_order) VALUES (99831,'重选测试级别',1)");
    jdbc.update("INSERT INTO stores (id,tenant_id,name,type,store_level_id,status) VALUES (99831,1,'重选测试门店','cityPartner',99831,'enabled')");
    jdbc.update("INSERT INTO roles (id,tenant_id,store_id,client_code,name,code,status) VALUES (99831,1,99831,'admin','重选测试角色','STORE_RESELECT_TEST','enabled')");
    jdbc.update("INSERT INTO suppliers (id,name,owner_scope,owner_id) VALUES (99831,'重选测试供应商','platform',0)");
    jdbc.update("INSERT INTO product_categories (id,name,scope) VALUES (99831,'重选测试分类','finished')");
    jdbc.update("INSERT INTO media_assets (id,public_id,storage_key,media_type,mime_type,owner_client_code) VALUES (99831,UUID(),'reselect-test','image','image/png','supply-chain')");
    jdbc.update("INSERT INTO finished_guide_price_settings (id,price_coefficient) VALUES (1,2) ON DUPLICATE KEY UPDATE price_coefficient=2");
    jdbc.update("""
        INSERT INTO finished_products
          (id,name,sku,supplier_id,category_id,detail,main_image_media_id,video_media_id,
           total_stock,status,source_status,operations_deleted)
        VALUES (99831,'重选测试商品','store-reselect-test',99831,99831,'详情',99831,99831,
          2,'selling','selling',FALSE)
        """);
    jdbc.update("INSERT INTO finished_product_variants (id,finished_product_id,variant_label,stock,cost_price) VALUES (99841,99831,'规格 A',2,10)");
    jdbc.update("INSERT INTO finished_product_prices (finished_product_id,sku_id,variant_label,store_level_id,store_level_name,price_coefficient,cost_price,price,price_source) VALUES (99831,99841,'规格 A',99831,'重选测试级别',1.5,10,15,'manual')");

    identity(99831L);
    long historicalId = products.select(List.of(99831L)).getFirst().id();
    jdbc.update("INSERT INTO store_finished_guide_prices (listing_id,sku_id,manual_price,updated_by_account_id) VALUES (?,?,?,?)",
        historicalId, 99841L, 25, 1);
    jdbc.update("INSERT INTO store_finished_role_price_overrides (listing_id,sku_id,role_id,manual_price,updated_by_account_id) VALUES (?,?,?,?,?)",
        historicalId, 99841L, 99831L, 12, 1);
    jdbc.update("UPDATE finished_products SET source_status='offShelf',status='recycle',operations_deleted=TRUE WHERE id=99831");
    jdbc.update("UPDATE store_finished_products SET invalidated_at=NOW(),invalidated_reason='来源已失效' WHERE id=?", historicalId);

    upstreamIdentity("supply-chain");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED, 99831L, "warehouse");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED, 99831L, "selling");

    identity(99831L);
    assertThat(products.list()).extracting(StoreFinishedProductService.ProductView::id).containsExactly(historicalId);
    assertThat(products.pool()).isEmpty();
    assertThat(products.detail(historicalId).sourceUnavailable()).isTrue();
    assertThat(products.detail(historicalId).sourceMessage()).contains("首次选入快照");
    assertThat(products.detail(historicalId).skus().getFirst().costPrice()).isEqualByComparingTo("15");
    assertThat(jdbc.queryForObject("SELECT manual_price FROM store_finished_guide_prices WHERE listing_id=?", BigDecimal.class, historicalId))
        .isEqualByComparingTo("25");
    assertThat(jdbc.queryForObject("SELECT manual_price FROM store_finished_role_price_overrides WHERE listing_id=?", BigDecimal.class, historicalId))
        .isEqualByComparingTo("12");
    assertThat(products.logs()).extracting(StoreFinishedProductService.LogEntry::operationType)
        .contains("SELECT", "SOURCE_SHELF");
    jdbc.update("UPDATE finished_products SET status='selling' WHERE id=99831");
    assertThat(products.pool()).isEmpty();
    assertThatThrownBy(() -> products.select(List.of(99831L))).hasMessageContaining("本店已存在");
    assertThatThrownBy(() -> products.changeStatus(historicalId, "selling", null, null)).hasMessageContaining("上游商品不可用");
    products.purge(historicalId);
    assertThat(products.pool()).extracting(StoreFinishedProductService.PoolProduct::id).containsExactly(99831L);
    long freshId = products.select(List.of(99831L)).getFirst().id();
    assertThat(freshId).isNotEqualTo(historicalId);
    assertThat(jdbc.queryForList("SELECT selection_generation FROM store_finished_products WHERE finished_product_id=99831 ORDER BY id", Long.class))
        .containsExactly(0L);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_finished_guide_prices WHERE listing_id=?", Long.class, freshId)).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_finished_role_price_overrides WHERE listing_id=?", Long.class, freshId)).isZero();
  }

  @Test
  void upstreamEventsRemainIndependentAndScopedAfterBothUpstreamSidesDelete() {
    jdbc.update("INSERT INTO store_levels (id,name,sort_order) VALUES (99821,'日志门店级别',1)");
    jdbc.update("INSERT INTO stores (id,tenant_id,name,type,store_level_id,status) VALUES (99821,1,'日志门店甲','cityPartner',99821,'enabled'),(99822,1,'日志门店乙','cityPartner',99821,'enabled')");
    jdbc.update("INSERT INTO finished_products (id,name,sku,total_stock,status,source_status,operations_deleted) VALUES (99821,'日志成品','store-log-test',1,'selling','selling',FALSE)");
    jdbc.update("INSERT INTO store_finished_products (id,tenant_id,store_id,finished_product_id,status,selected_by_account_id) VALUES (99821,1,99821,99821,'selling',1),(99822,1,99822,99821,'warehouse',1)");

    upstreamIdentity("admin");
    FinishedProduct offShelf = new FinishedProduct();
    offShelf.setStatus("offShelf");
    offShelf.setOffShelfReason("其他");
    finishedProducts.updateOperationWithDetails(99821L, offShelf, false);
    FinishedProduct recycle = new FinishedProduct();
    recycle.setStatus("recycle");
    finishedProducts.updateOperationWithDetails(99821L, recycle, false);
    lifecycle.purgeOperations(ProductLifecycleService.Kind.FINISHED, 99821L);
    upstreamIdentity("supply-chain");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED, 99821L, "offShelf", "其他", null);
    lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED, 99821L, "recycle");
    finishedProducts.removeById(99821L);

    identity(99821L);
    var firstPage = products.logPage("", "", "", "", "", 1, 2);
    assertThat(firstPage.total()).isEqualTo(6);
    assertThat(firstPage.records()).hasSize(2);
    assertThat(firstPage.records()).extracting(StoreFinishedProductService.LogEntry::operationType)
        .containsExactly("SOURCE_PURGE", "SOURCE_DELETE_TO_RECYCLE");
    assertThat(products.logPage("", "", "", "", "", 1, 10).records())
        .extracting(StoreFinishedProductService.LogEntry::operationType)
        .contains("OPERATIONS_OFF_SHELF", "OPERATIONS_DELETE_TO_RECYCLE", "OPERATIONS_PURGE");
    Long otherStoreLogId = jdbc.queryForObject(
        "SELECT id FROM store_finished_operation_logs WHERE store_id=99822 ORDER BY id DESC LIMIT 1",
        Long.class);
    assertThatThrownBy(() -> products.logDetail(otherStoreLogId))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(products.detail(99821L).status()).isEqualTo("selling");
    assertThat(products.detail(99821L).sourceMessage())
        .isEqualTo("运营端已下架该商品，请彻底删除后重新选择");
    products.purge(99821L);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_products WHERE id=99821",
        Integer.class)).isEqualTo(1);

    identity(99822L);
    assertThat(products.logPage("", "", "", "", "", 1, 10).total()).isEqualTo(6);
    products.purge(99822L);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_products WHERE id=99821",
        Integer.class)).isZero();
    assertThat(products.logDetail(otherStoreLogId).operationType()).isEqualTo("SOURCE_PURGE");
  }

  @Test
  @Transactional
  void invalidationSurvivesSourceRecoveryKeepsSnapshotsAndPreventsDuplicateSelection() {
    jdbc.update("INSERT INTO store_levels (id,name,sort_order) VALUES (99891,'失效测试级别',1)");
    jdbc.update("INSERT INTO stores (id,tenant_id,name,type,store_level_id,status) VALUES (99891,1,'失效甲店','cityPartner',99891,'enabled'),(99892,1,'失效乙店','cityPartner',99891,'enabled')");
    jdbc.update("INSERT INTO finished_products (id,name,sku,total_stock,status,source_status,operations_deleted) VALUES (99891,'原商品','invalidation-test',2,'selling','selling',FALSE)");
    jdbc.update("INSERT INTO finished_product_variants (id,finished_product_id,variant_label,stock,cost_price) VALUES (99891,99891,'原规格',2,10)");
    identity(99891L);
    long first = products.select(List.of(99891L)).getFirst().id();
    jdbc.update("UPDATE store_finished_products SET status='selling' WHERE id=?", first);
    identity(99892L);
    long other = products.select(List.of(99891L)).getFirst().id();
    upstreamIdentity("supply-chain");
    upstreamLogs.sourceChange(99891L, "selling", "offShelf");
    jdbc.update("UPDATE finished_products SET name='新商品',total_stock=0,status='selling',source_status='selling' WHERE id=99891");
    jdbc.update("UPDATE finished_product_variants SET variant_label='新规格',cost_price=99 WHERE id=99891");
    sqlSession.clearCache();
    upstreamLogs.sourceChange(99891L, "offShelf", "selling");
    upstreamLogs.operationsChange(99891L, "SHELF", "warehouse", "selling");
    identity(99891L);
    var retained = products.detail(first);
    assertThat(retained.sourceUnavailable()).isTrue();
    assertThat(retained.effectiveStatus()).isEqualTo("selling");
    assertThat(retained.name()).isEqualTo("原商品");
    assertThat(retained.skus().getFirst().label()).isEqualTo("原规格");
    assertThat(products.pool()).isEmpty();
    assertThatThrownBy(() -> products.changeStatus(first, "recycle", null, null)).hasMessageContaining("上游商品不可用");
    assertThatThrownBy(() -> products.detail(other)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> products.purge(other)).isInstanceOf(IllegalArgumentException.class);
    jdbc.update("UPDATE finished_products SET total_stock=2 WHERE id=99891");
    assertThatThrownBy(() -> products.select(List.of(99891L))).hasMessageContaining("本店已存在");
    products.purge(first);
    long fresh = products.select(List.of(99891L)).getFirst().id();
    assertThat(fresh).isNotEqualTo(first);
    assertThat(products.detail(fresh).sourceUnavailable()).isFalse();
    assertThat(products.detail(fresh).name()).isEqualTo("新商品");
    assertThat(products.logPage("99891", "", "", "", "", 1, 100).records())
        .extracting(StoreFinishedProductService.LogEntry::listingId).contains(first, fresh).doesNotContain(other);
    identity(99892L);
    assertThat(products.detail(other).sourceUnavailable()).isTrue();
  }

  private void upstreamIdentity(String clientCode) {
    CurrentIdentity identity = new CurrentIdentity(1L, 1L, 1L, null, clientCode, 1L, null,
        "上游测试人员", "all", List.of(), List.of("all"));
    SecurityContextHolder.getContext().setAuthentication(
        new UsernamePasswordAuthenticationToken(identity, null, List.of()));
  }

  private void identity(Long storeId) {
    CurrentIdentity identity = new CurrentIdentity(1L, 1L, 1L, null, "admin", 1L, storeId,
        "门店测试员工", "self", List.of("STORE_ADMIN"), List.of("self"));
    SecurityContextHolder.getContext().setAuthentication(
        new UsernamePasswordAuthenticationToken(identity, null, List.of()));
  }

  private void identityWithPermissions(Long storeId, String... permissions) {
    CurrentIdentity identity = new CurrentIdentity(1L, 1L, 1L, null, "admin", 1L, storeId,
        "门店测试员工", "self", List.of("STORE_ADMIN"), List.of(permissions));
    SecurityContextHolder.getContext().setAuthentication(
        new UsernamePasswordAuthenticationToken(identity, null, List.of()));
  }
}
