package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.common.BaseEntity;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.support.SpringContainerTestSupport;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
@Transactional
class PriceConfigurationSyncScopeTest extends SpringContainerTestSupport {
  @Container private static final MySQLContainer<?> MYSQL = com.zdm.platform.support.MySqlTestDatabase.create()
      .withDatabaseName("price_sync_scope").withUsername("test").withPassword("test");
  @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
  }
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ObjectMapper json;
  @Autowired private FinishedMarkupConfigurationService finished;
  @Autowired private AccessoryMarkupConfigurationService accessory;
  @Autowired private SlabMarkupConfigurationService slab;
  @Autowired private FinishedPriceConfigurationSyncService finishedSync;
  @Autowired private AccessoryPriceConfigurationSyncService accessorySync;
  @Autowired private SlabPriceConfigurationSyncService slabSync;
  @AfterEach void clear() { SecurityContextHolder.clearContext(); }

  @ParameterizedTest
  @ValueSource(strings = {"finished", "accessory", "slab"})
  void allConfigurationPathsSkipDeletedProductsAndKeepReferenceProtection(String kind) {
    var identity = new CurrentIdentity(1L, 1L, 1L, 1L, "admin", null, null, "同步范围测试", "all",
        List.of("OPERATOR"), List.of("all"));
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(identity, null, List.of()));
    jdbc.update("INSERT INTO store_levels (id,name,sort_order,status) VALUES (99770,'同步范围级别',1,'enabled')");
    product(kind, 99781, "warehouse", false);
    product(kind, 99782, "selling", false);
    product(kind, 99783, "recycle", true);
    product(kind, 99784, "warehouse", false);
    product(kind, 99785, "warehouse", false);
    price(kind, 99785, "manual");
    BaseEntity created = create(kind);
    assertThat(json.valueToTree(created).has("synchronizedPriceCount")).isFalse();
    long configurationId = created.getId();
    amount(kind, 99781, "20");
    amount(kind, 99782, "20");
    amount(kind, 99784, "20");
    amount(kind, 99785, "20");
    missing(kind, 99783);
    jdbc.update("UPDATE " + products(kind) + " SET operations_deleted=TRUE WHERE id=99784");
    update(kind, configurationId, "3");
    amount(kind, 99781, "30");
    amount(kind, 99782, "30");
    amount(kind, 99784, "20");
    amount(kind, 99785, "20");
    missing(kind, 99783);
    jdbc.update("UPDATE " + kind + "_markup_configurations SET price_coefficient=4 WHERE id=?", configurationId);
    switch (kind) {
      case "finished" -> finishedSync.syncEnabledStoreLevel(99770L);
      case "accessory" -> accessorySync.syncEnabledStoreLevel(99770L);
      default -> slabSync.syncEnabledStoreLevel(99770L);
    }
    amount(kind, 99781, "40");
    amount(kind, 99784, "20");
    missing(kind, 99783);
    status(kind, configurationId, "disabled");
    product(kind, 99786, "warehouse", false);
    update(kind, configurationId, "5");
    amount(kind, 99781, "40");
    missing(kind, 99786);
    status(kind, configurationId, "enabled");
    amount(kind, 99781, "50");
    amount(kind, 99782, "50");
    amount(kind, 99786, "50");
    amount(kind, 99784, "20");
    amount(kind, 99785, "20");
    missing(kind, 99783);
    // The retained deleted product reference still protects the configuration from deletion.
    jdbc.update("DELETE FROM " + prices(kind) + " WHERE " + key(kind) + " IN (99781,99782,99786)");
    assertThatThrownBy(() -> {
      switch (kind) {
        case "finished" -> finished.deleteConfiguration(configurationId);
        case "accessory" -> accessory.deleteConfiguration(configurationId);
        default -> slab.deleteConfiguration(configurationId);
      }
    }).isInstanceOf(IllegalArgumentException.class);
  }

  private BaseEntity create(String kind) {
    if ("finished".equals(kind)) {
      var value = new FinishedMarkupConfiguration(); value.setStoreLevelId(99770L); value.setPriceCoefficient(new BigDecimal("2"));
      return finished.createConfiguration(value);
    }
    if ("accessory".equals(kind)) {
      var value = new AccessoryMarkupConfiguration(); value.setStoreLevelId(99770L); value.setPriceCoefficient(new BigDecimal("2"));
      return accessory.createConfiguration(value);
    }
    var value = new SlabMarkupConfiguration(); value.setStoreLevelId(99770L); value.setPriceCoefficient(new BigDecimal("2"));
    return slab.createConfiguration(value);
  }
  private void update(String kind, long id, String coefficient) {
    if ("finished".equals(kind)) {
      var value = new FinishedMarkupConfiguration(); value.setPriceCoefficient(new BigDecimal(coefficient)); finished.updateConfiguration(id, value);
    } else if ("accessory".equals(kind)) {
      var value = new AccessoryMarkupConfiguration(); value.setPriceCoefficient(new BigDecimal(coefficient)); accessory.updateConfiguration(id, value);
    } else {
      var value = new SlabMarkupConfiguration(); value.setPriceCoefficient(new BigDecimal(coefficient)); slab.updateConfiguration(id, value);
    }
  }
  private void status(String kind, long id, String status) {
    switch (kind) {
      case "finished" -> finished.updateStatus(id, status);
      case "accessory" -> accessory.updateStatus(id, status);
      default -> slab.updateStatus(id, status);
    }
  }
  private String products(String kind) { return "slab".equals(kind) ? "slab_inventory" : kind + "_products"; }
  private String prices(String kind) { return "slab".equals(kind) ? "slab_prices" : kind + "_product_prices"; }
  private String key(String kind) { return "slab".equals(kind) ? "slab_id" : kind + "_product_id"; }
  private void product(String kind, long id, String status, boolean deleted) {
    if ("slab".equals(kind)) {
      jdbc.update("INSERT INTO slab_inventory (id,name,serial_no,status,source_status,operations_deleted,cost_price) VALUES (?,? ,?,?,'selling',?,10)", id, "测试大板" + id, "SYNC-" + id, status, deleted);
    } else {
      jdbc.update("INSERT INTO " + products(kind) + " (id,name,sku,status,source_status,operations_deleted) VALUES (?,?,?,?,'selling',?)", id, "测试商品" + id, "SYNC-" + id, status, deleted);
      jdbc.update("INSERT INTO " + kind + "_product_variants (id," + key(kind) + ",variant_label,stock,cost_price) VALUES (?,?,'规格',1,10)", id, id);
      jdbc.update("INSERT INTO " + kind + "_product_guide_prices (" + key(kind) + ",sku_id,variant_label,price_coefficient,cost_price,price) VALUES (?,?,'规格',3,10,30)", id, id);
    }
  }
  private void price(String kind, long id, String source) {
    jdbc.update("INSERT INTO " + prices(kind) + " (" + key(kind) + ",store_level_id,store_level_name,price_coefficient,cost_price,price,price_source"
        + ("slab".equals(kind) ? "" : ",sku_id,variant_label") + ") VALUES (?,99770,'同步范围级别',2,10,20,?"
        + ("slab".equals(kind) ? ")" : ",?,'规格')"), "slab".equals(kind) ? new Object[]{id, source} : new Object[]{id, source, id});
  }
  private void amount(String kind, long id, String amount) {
    assertThat(jdbc.queryForObject("SELECT price FROM " + prices(kind) + " WHERE " + key(kind) + "=? AND store_level_id=99770", BigDecimal.class, id)).isEqualByComparingTo(amount);
  }
  private void missing(String kind, long id) {
    assertThat(jdbc.queryForList("SELECT price FROM " + prices(kind) + " WHERE " + key(kind) + "=? AND store_level_id=99770", BigDecimal.class, id)).isEmpty();
  }
}
