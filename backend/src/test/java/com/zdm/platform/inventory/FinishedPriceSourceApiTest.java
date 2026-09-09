package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.zdm.platform.security.TokenAuthenticationFilter;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class FinishedPriceSourceApiTest {
  @Container private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("finished_price_source").withUsername("zdm_admin").withPassword("zdm_admin_pwd");
  @Autowired private JdbcTemplate jdbc;
  @Autowired private MockMvc mvc;
  @Autowired private FinishedProductPriceService prices;
  @Autowired private FinishedPriceConfigurationSyncService sync;
  @Autowired private FinishedMarkupConfigurationMapper configurations;
  private final String token = "Bearer " + TokenAuthenticationFilter.createAccountToken(1L);
  @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
  }

  @Test
  void followsOnlyAutoPricesAndFreezesDisabledConfiguration() throws Exception {
    jdbc.update("UPDATE store_levels SET status = 'disabled'");
    jdbc.update("INSERT INTO store_levels (id, name, sort_order) VALUES (99101, '来源测试级别', 1)");
    jdbc.update("INSERT INTO finished_products (id, name, sku) VALUES (99101, '来源测试商品', 'source-test')");
    jdbc.update("""
        INSERT INTO finished_markup_configurations
          (id, name, store_level_id, price_coefficient, status, legacy_seeded, sort_order)
        VALUES (99101, '来源测试级别', 99101, 2, 'enabled', false, 1)
        """);
    for (String key : List.of("A", "B")) {
      jdbc.update("""
          INSERT INTO finished_product_guide_prices
            (finished_product_id, variant_key, variant_label, price_coefficient, cost_price, price)
          VALUES (99101, ?, ?, 3, 10, 30)
          """, key, key);
    }
    assertThat(sync.backfillMissingPrices(configurations.selectById(99101L))).isEqualTo(2);
    List<FinishedProductPrice> existing = prices.listPrices(99101L);
    existing.get(1).setPriceSource("manual");
    prices.replacePrices(99101L, existing);
    updateCoefficient(4);
    assertPrice("A", "40", "auto");
    assertPrice("B", "20", "manual");
    mvc.perform(delete("/api/admin/finished-markup-configurations/99101").header("Authorization", token))
        .andExpect(status().isBadRequest());
    setStatus("disabled");
    updateCoefficient(5);
    assertPrice("A", "40", "auto");
    setStatus("enabled");
    assertPrice("A", "50", "auto");
    assertPrice("B", "20", "manual");
    List<FinishedProductPrice> restored = prices.listPrices(99101L);
    restored.get(1).setPriceSource("auto");
    restored.get(1).setPriceCoefficient(new BigDecimal("5"));
    restored.get(1).setPrice(new BigDecimal("50"));
    prices.replacePrices(99101L, restored);
    updateCoefficient(6);
    assertPrice("A", "60", "auto");
    assertPrice("B", "60", "auto");
  }

  private void updateCoefficient(int value) throws Exception {
    mvc.perform(put("/api/admin/finished-markup-configurations/99101").header("Authorization", token)
        .contentType("application/json").content("{\"storeLevelId\":99101,\"priceCoefficient\":" + value + "}"))
        .andExpect(status().isOk());
  }
  private void setStatus(String value) throws Exception {
    mvc.perform(patch("/api/admin/finished-markup-configurations/99101/status").header("Authorization", token)
        .contentType("application/json").content("{\"status\":\"" + value + "\"}"))
        .andExpect(status().isOk());
  }
  private void assertPrice(String key, String value, String source) {
    FinishedProductPrice row = prices.listPrices(99101L).stream()
        .filter(price -> key.equals(price.getVariantKey())).findFirst().orElseThrow();
    assertThat(row.getPrice()).isEqualByComparingTo(value);
    assertThat(row.getPriceSource()).isEqualTo(source);
  }
}
