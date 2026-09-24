package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.support.SpringContainerTestSupport;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
class StoreFinishedProductServiceTest extends SpringContainerTestSupport {
  @Container private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("store_finished_test").withUsername("zdm_admin").withPassword("zdm_admin_pwd");
  @Autowired private JdbcTemplate jdbc;
  @Autowired private StoreFinishedProductService products;
  @Autowired private StoreFinishedPriceConfigurationService configurations;
  @Autowired private ProductLifecycleService lifecycle;
  @Autowired private FinishedProductService finishedProducts;

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
    products.saveGuidePrice(listingId, 99811L, new BigDecimal("140"));
    assertThat(products.currentEmployeeMinimumPrice(listingId, 99811L).price()).isEqualByComparingTo("50");
    assertThat(products.currentEmployeeMinimumPrice(listingId, 99811L).roleId()).isEqualTo(99801L);
    jdbc.update("UPDATE finished_product_prices SET price=200 WHERE finished_product_id=99801");
    jdbc.update("UPDATE finished_product_guide_prices SET price=170 WHERE finished_product_id=99801");
    var repriced = products.detail(listingId).skus().getFirst();
    assertThat(repriced.costPrice()).isEqualByComparingTo("200");
    assertThat(repriced.guidePrice()).isEqualByComparingTo("140");
    assertThat(repriced.rolePrices().stream().filter(item -> item.roleId() == 99802L).findFirst().orElseThrow().price())
        .isEqualByComparingTo("160.00");
    assertThat(products.currentEmployeeMinimumPrice(listingId, 99811L).price()).isEqualByComparingTo("50");
    products.changeStatus(listingId, "selling", null, null);
    jdbc.update("UPDATE finished_products SET source_status='offShelf' WHERE id=99801");
    assertThat(products.detail(listingId).sourceUnavailable()).isTrue();
    assertThatThrownBy(() -> products.changeStatus(listingId, "offShelf", "其他", null))
        .isInstanceOf(IllegalArgumentException.class);
    jdbc.update("UPDATE finished_products SET source_status='selling' WHERE id=99801");
    assertThat(products.detail(listingId).status()).isEqualTo("selling");
    jdbc.update("UPDATE finished_products SET total_stock=0 WHERE id=99801");
    assertThat(products.detail(listingId).effectiveStatus()).isEqualTo("soldOut");
    assertThat(products.logs()).isNotEmpty();

    identity(99802L);
    assertThat(products.list()).isEmpty();
    assertThatThrownBy(() -> products.detail(listingId)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void republishedPurgedOperationsProductRequiresFreshSelectionAndKeepsHistoricalPrices() {
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
    products.saveGuidePrice(historicalId, 99841L, new BigDecimal("25"));
    jdbc.update("INSERT INTO store_finished_role_price_overrides (listing_id,sku_id,role_id,manual_price,updated_by_account_id) VALUES (?,?,?,?,?)",
        historicalId, 99841L, 99831L, 12, 1);
    jdbc.update("UPDATE finished_products SET source_status='offShelf',status='recycle',operations_deleted=TRUE WHERE id=99831");

    upstreamIdentity("supply-chain");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED, 99831L, "warehouse");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED, 99831L, "selling");

    identity(99831L);
    assertThat(products.list()).isEmpty();
    assertThat(products.pool()).isEmpty();
    assertThatThrownBy(() -> products.detail(historicalId)).isInstanceOf(IllegalArgumentException.class);
    assertThat(jdbc.queryForObject("SELECT manual_price FROM store_finished_guide_prices WHERE listing_id=?", BigDecimal.class, historicalId))
        .isEqualByComparingTo("25");
    assertThat(jdbc.queryForObject("SELECT manual_price FROM store_finished_role_price_overrides WHERE listing_id=?", BigDecimal.class, historicalId))
        .isEqualByComparingTo("12");
    assertThat(products.logs()).extracting(StoreFinishedProductService.LogEntry::operationType)
        .contains("SELECT", "SOURCE_SHELF");
    jdbc.update("UPDATE finished_products SET status='selling' WHERE id=99831");
    assertThat(products.pool()).extracting(StoreFinishedProductService.PoolProduct::id).containsExactly(99831L);
    long freshId = products.select(List.of(99831L)).getFirst().id();
    assertThat(freshId).isNotEqualTo(historicalId);
    assertThat(jdbc.queryForList("SELECT selection_generation FROM store_finished_products WHERE finished_product_id=99831 ORDER BY id", Long.class))
        .containsExactly(0L, 1L);
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
        .isEqualTo("该商品已被供应链彻底删除；该商品已被运营端彻底删除");
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
}
