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

  private void identity(Long storeId) {
    CurrentIdentity identity = new CurrentIdentity(1L, 1L, 1L, null, "admin", 1L, storeId,
        "门店测试员工", "self", List.of("STORE_ADMIN"), List.of("self"));
    SecurityContextHolder.getContext().setAuthentication(
        new UsernamePasswordAuthenticationToken(identity, null, List.of()));
  }
}
