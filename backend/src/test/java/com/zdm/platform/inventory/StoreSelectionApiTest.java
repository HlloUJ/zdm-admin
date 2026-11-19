package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.support.SpringContainerTestSupport;
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
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@Testcontainers
class StoreSelectionApiTest extends SpringContainerTestSupport {
  @Container private static final MySQLContainer<?> MYSQL = com.zdm.platform.support.MySqlTestDatabase.create()
      .withDatabaseName("selection_api").withUsername("selection_api").withPassword("selection_api");
  @Autowired private JdbcTemplate jdbc;
  @Autowired private MockMvc mvc;
  @Autowired private StoreSelectionService service;
  @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url",MYSQL::getJdbcUrl);registry.add("spring.datasource.username",MYSQL::getUsername);registry.add("spring.datasource.password",MYSQL::getPassword);
  }
  @AfterEach void clear(){SecurityContextHolder.clearContext();}
  private void identity(String... permissions){var identity=new CurrentIdentity(1L,1L,1L,null,"admin",1L,69901L,"选品员工","self",List.of("STORE_ADMIN"),List.of(permissions));SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(identity,null,List.of()));}

  @Test void authenticatedCatalogUsesRealPricesAndJoinCreatesOneWarehouseSnapshotAndLog() throws Exception {
    jdbc.update("INSERT INTO store_levels(id,name,sort_order) VALUES(69901,'选品级别',1)");
    jdbc.update("INSERT INTO stores(id,tenant_id,name,type,store_level_id,status) VALUES(69901,1,'选品门店','cityPartner',69901,'enabled')");
    jdbc.update("INSERT INTO finished_products(id,name,sku,total_stock,status,source_status,operations_deleted) VALUES(69901,'真实选品商品','center-real',5,'selling','selling',FALSE)");
    jdbc.update("INSERT INTO finished_product_variants(id,finished_product_id,variant_label,stock,cost_price) VALUES(69901,69901,'白色',5,17)");
    jdbc.update("INSERT INTO finished_product_prices(finished_product_id,sku_id,variant_label,store_level_id,store_level_name,price_coefficient,cost_price,price,price_source) VALUES(69901,69901,'白色',69901,'选品级别',1,17,100,'manual')");
    jdbc.update("INSERT INTO finished_product_guide_prices(finished_product_id,sku_id,variant_label,price_coefficient,cost_price,price) VALUES(69901,69901,'白色',1,17,300)");
    jdbc.update("INSERT INTO accessory_products(id,name,sku,total_stock,status,source_status,operations_deleted) VALUES(69901,'只读配件','center-accessory',0,'selling','soldOut',FALSE)");
    identity();mvc.perform(get("/api/admin/store-product-center/context")).andExpect(status().isForbidden());
    identity(StoreSelectionCatalog.FINISHED_PERMISSION);
    mvc.perform(get("/api/admin/store-product-center/context")).andExpect(status().isOk()).andExpect(jsonPath("$.data.key").value("1:69901:1")).andExpect(jsonPath("$.data.maintain.accessory").value(false));
    mvc.perform(get("/api/admin/store-product-center/products/accessory/69901").param("context","1:69901:1")).andExpect(status().isOk()).andExpect(jsonPath("$.data.product.soldOut").value(true));
    mvc.perform(post("/api/admin/store-product-center/selection").contentType("application/json").content("{\"context\":\"1:69901:1\",\"type\":\"accessory\",\"productId\":69901}")).andExpect(status().isForbidden());
    mvc.perform(get("/api/admin/store-product-center/products/finished/69901").param("context","1:69901:1")).andExpect(status().isOk()).andExpect(jsonPath("$.data.information.skus[0].partnerPrice").value(100)).andExpect(jsonPath("$.data.information.skus[0].guidePrice").doesNotExist()).andExpect(jsonPath("$.data.information.skus[0].costPrice").doesNotExist());
    service.add("1:69901:1","finished",69901L);
    var result=service.join("1:69901:1","real-selection-request-01");assertThat(result.successCount()).isEqualTo(1);assertThat(result.failureCount()).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_finished_products WHERE store_id=69901 AND finished_product_id=69901 AND status='warehouse'",Long.class)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_finished_operation_logs WHERE store_id=69901 AND finished_product_id=69901 AND operation_type='SELECT'",Long.class)).isEqualTo(1);
    assertThat(service.join("1:69901:1","real-selection-request-01")).isEqualTo(result);
    mvc.perform(get("/api/admin/store-product-center/join-batches/"+result.id()).param("context","1:2:1")).andExpect(status().isForbidden());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_selection_items WHERE store_id=69901",Long.class)).isZero();
  }
}
